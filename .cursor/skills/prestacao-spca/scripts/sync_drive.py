#!/usr/bin/env python3
"""
Sincroniza planilhas do SPCA UP V2 no Google Drive.

Integração exclusiva via Composio CLI + toolkit **googlesuper**:
  composio execute GOOGLESUPER_<ACTION> -d '{...}' [--file path]

Nunca usar slugs GOOGLEDRIVE_* nem `composio link googledrive`.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_paths import ESTADOS, resolver_mes  # noqa: E402
from with_backup import with_backup  # noqa: E402

# Caminho canônico do manifest de sync. Mutações de save_manifest() são
# protegidas por @with_backup na chamada dentro de sync() — ver bloco
# _save_manifest_com_backup. A constante é relativa porque `raiz` é
# resolvida em runtime (--raiz explícito ou cwd).
MANIFEST_REL = Path("resultados") / "drive_manifest.json"

# Composio: único toolkit permitido para Drive neste projeto.
COMPOSIO_TOOLKIT = "googlesuper"

# Slugs googlesuper usados pelo sync (composio execute <slug>).
TOOL_FIND_FILE = "GOOGLESUPER_FIND_FILE"
TOOL_CREATE_FOLDER = "GOOGLESUPER_CREATE_FOLDER"
TOOL_UPLOAD_FILE = "GOOGLESUPER_UPLOAD_FILE"
TOOL_DELETE_FILE = "GOOGLESUPER_GOOGLE_DRIVE_DELETE_FOLDER_OR_FILE_ACTION"
TOOL_CREATE_SHEET = "GOOGLESUPER_CREATE_GOOGLE_SHEET1"
TOOL_DOWNLOAD_FILE = "GOOGLESUPER_DOWNLOAD_FILE"
TOOL_GET_METADATA = "GOOGLESUPER_GET_FILE_METADATA"

SKIP_DIRS = {".venv", ".cache", ".git", "scripts"}
ROOT_NAME = "SPCA UP V2"

# Padrão: planilhas base + saídas das prestações ativas no Drive.
PLANILHA_SUFFIXES = {".xlsx", ".xls"}

ARQUIVO_DIRETORIOS = "diretorios.xlsx"

# (estado, escopo municipal ou None para estadual)
PRESTACOES_EXPORTACAO: tuple[tuple[str, str | None], ...] = (
    ("Bahia", None),
    ("Santa Catarina", None),
    ("Paraíba", "joao-pessoa"),
    ("Paraíba", "patos"),
    ("Paraíba", "campina-grande"),
)

SAIDAS_MENSAIS = {
    "Consolidado_SPCA_Sucesso.xlsx",
    "Exportacao_Mensal.xlsx",
    "Pendencias_e_Inconsistencias.xlsx",
    "Revisao_Exportacao_SPCA.xlsx",
    "Revisao_Exportacao_SPCA_Anual.xlsx",
    "Revisao_Exportacao_SPCA_Anual-patos.xlsx",
}

SAIDAS_ANUAIS = {
    "lista-anual.xlsx",
    "pessoas_fora_cadastro.xlsx",
}

# Modo legado --completo: espelha também PDFs, JSON e documentos.
UPLOAD_SUFFIXES_COMPLETO = PLANILHA_SUFFIXES | {
    ".pdf",
    ".json",
    ".doc",
    ".docx",
}

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # limite GOOGLESUPER_UPLOAD_FILE


def _slug_permitido(slug: str) -> None:
    if not slug.startswith("GOOGLESUPER_"):
        raise ValueError(
            f"Slug {slug!r} bloqueado — use apenas GOOGLESUPER_* via composio link {COMPOSIO_TOOLKIT}"
        )


def verificar_conexao_googlesuper() -> None:
    """Garante conta Composio ativa e toolkit googlesuper conectado."""
    who = subprocess.run(["composio", "whoami"], capture_output=True, text=True)
    if who.returncode != 0:
        raise SystemExit(
            "Composio não autenticado.\n"
            "  composio login\n"
            f"  composio link {COMPOSIO_TOOLKIT}"
        )
    listed = subprocess.run(
        ["composio", "connections", "list"],
        capture_output=True,
        text=True,
    )
    if listed.returncode != 0 or f'"{COMPOSIO_TOOLKIT}"' not in listed.stdout:
        raise SystemExit(
            f"Toolkit {COMPOSIO_TOOLKIT!r} não conectado.\n"
            f"  composio link {COMPOSIO_TOOLKIT}"
        )


def composio_execute(slug: str, data: dict | None = None, file_path: Path | None = None) -> dict:
    """Executa `composio execute <slug>` — somente GOOGLESUPER_*."""
    _slug_permitido(slug)
    cmd = ["composio", "execute", slug]
    if file_path is not None:
        cmd.extend(["--file", str(file_path)])
    cmd.extend(["-d", json.dumps(data or {})])
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{slug} failed:\n{result.stdout}\n{result.stderr}")
    payload = json.loads(result.stdout)
    if not payload.get("successful", True):
        hint = ""
        err = str(payload.get("error") or "")
        if "No active connection" in err and COMPOSIO_TOOLKIT not in err:
            hint = f"\nUse apenas {COMPOSIO_TOOLKIT}: composio link {COMPOSIO_TOOLKIT}"
        raise RuntimeError(f"{slug} unsuccessful: {payload}{hint}")
    return payload.get("data", payload)


def escape_drive_name(name: str) -> str:
    return name.replace("'", "\\'")


def find_folder(name: str, parent_id: str | None = None) -> str | None:
    safe = escape_drive_name(name)
    if parent_id:
        q = (
            f"name = '{safe}' and mimeType = 'application/vnd.google-apps.folder' "
            f"and trashed = false and '{parent_id}' in parents"
        )
    else:
        q = (
            f"name = '{safe}' and mimeType = 'application/vnd.google-apps.folder' "
            "and trashed = false"
        )
    data = composio_execute(TOOL_FIND_FILE, {"q": q, "pageSize": 5})
    files = data.get("files") or []
    return files[0]["id"] if files else None


def ensure_folder(name: str, parent_id: str | None = None) -> str:
    existing = find_folder(name, parent_id)
    if existing:
        return existing
    payload: dict = {"name": name}
    if parent_id:
        payload["parent_id"] = parent_id
    data = composio_execute(TOOL_CREATE_FOLDER, payload)
    folder_id = data.get("id") or data.get("folder_id")
    if not folder_id:
        raise RuntimeError(f"CREATE_FOLDER sem id para {name}: {data}")
    time.sleep(0.25)
    return folder_id


def load_manifest(raiz: Path) -> dict:
    path = raiz / "resultados" / "drive_manifest.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_manifest(raiz: Path, manifest: dict) -> Path:
    out = raiz / MANIFEST_REL
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return out


def _normalizar_rel(rel: str) -> str:
    return rel.replace("\\", "/").strip("/")


def _nome_cadastro_estados() -> set[str]:
    return {arquivo for _, arquivo in ESTADOS.values()}


def is_arquivo_backup(name: str) -> bool:
    return ".backup-" in name.lower()


def prestacao_exporta(estado: str, escopo: str | None) -> bool:
    for nome, sub in PRESTACOES_EXPORTACAO:
        if nome == estado and sub == escopo:
            return True
    return False


def _arquivo_mensal_elegivel(name: str) -> bool:
    if name in SAIDAS_MENSAIS:
        return True
    for suf in SAIDAS_MENSAIS:
        if name.endswith(f"-{suf}"):
            return True
    if name.startswith("Revisao_Exportacao_SPCA-r") and name.endswith(".xlsx"):
        return True
    return False


def deve_sincronizar_arquivo(file_path: Path, raiz: Path) -> bool:
    """
    Planilhas no Drive:
    - diretorios.xlsx (raiz)
    - {Estado}/cadastro/pessoas {estado}.xlsx
    - saídas de Bahia, Santa Catarina e João Pessoa (Paraíba/joao-pessoa)
    """
    if file_path.suffix.lower() not in PLANILHA_SUFFIXES:
        return False
    name = file_path.name
    if is_arquivo_backup(name):
        return False

    rel = file_path.relative_to(raiz).as_posix()
    if rel == ARQUIVO_DIRETORIOS:
        return True

    parts = Path(rel).parts
    if len(parts) == 3 and parts[1] == "cadastro" and name in _nome_cadastro_estados():
        return True

    if len(parts) < 3 or not parts[1].isdigit():
        return False

    estado, _ano = parts[0], parts[1]
    for prest_estado, escopo in PRESTACOES_EXPORTACAO:
        if estado != prest_estado:
            continue
        if escopo:
            if len(parts) < 4 or parts[2] != escopo:
                return False
            rest = parts[3:]
        else:
            if len(parts) > 2 and parts[2] == "joao-pessoa":
                return False
            rest = parts[2:]
        if len(rest) == 1:
            return name in SAIDAS_ANUAIS
        if rest[0] == "mensal" and len(rest) == 2:
            return _arquivo_mensal_elegivel(rest[1])
        if len(rest) >= 2:
            return name in SAIDAS_MENSAIS or _arquivo_mensal_elegivel(name)
    return False


def is_caminho_fonte_processamento(rel: str) -> bool:
    """PDFs/planilhas manuais de extrato — ficam só local."""
    lower = _normalizar_rel(rel).lower()
    if not lower:
        return False
    if "prestação de contas" in lower or "prestacao de contas" in lower:
        return True
    if "/fontes/" in lower or lower.endswith("/fontes"):
        return True
    if lower.startswith("bahia/bahia"):
        return True
    return False


def _dentro_escopo(rel_dir: str, only_under: list[str] | None) -> bool:
    if not only_under:
        return True
    rel = _normalizar_rel(rel_dir)
    for p in only_under:
        base = _normalizar_rel(p)
        if not base:
            if rel == "":
                return True
            continue
        if rel == base or rel.startswith(base + "/"):
            return True
    return False


def iter_upload_files(
    raiz: Path,
    only_under: list[str] | None = None,
    *,
    suffixes: set[str] | None = None,
    modo_planilhas: bool = True,
) -> list[tuple[str, Path]]:
    allowed = suffixes or (PLANILHA_SUFFIXES if modo_planilhas else UPLOAD_SUFFIXES_COMPLETO)
    files: list[tuple[str, Path]] = []
    for dirpath, dirnames, filenames in os.walk(raiz):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        if any(part in SKIP_DIRS for part in Path(dirpath).parts):
            continue
        rel_dir = os.path.relpath(dirpath, raiz).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""
        if modo_planilhas and is_caminho_fonte_processamento(rel_dir):
            continue
        if not _dentro_escopo(rel_dir, only_under):
            continue
        for name in filenames:
            if Path(name).suffix.lower() not in allowed:
                continue
            path = Path(dirpath) / name
            if modo_planilhas and not deve_sincronizar_arquivo(path, raiz):
                continue
            files.append((rel_dir, path))
    return sorted(files, key=lambda x: str(x[1]).lower())


def dirs_para_arquivos(files: list[tuple[str, Path]]) -> list[str]:
    """Só pastas ancestrais dos arquivos a enviar — evita espelhar árvore inteira."""
    dirs: set[str] = set()
    for rel_dir, _ in files:
        parts = Path(rel_dir).parts if rel_dir else ()
        for i in range(len(parts) + 1):
            dirs.add("/".join(parts[:i]))
    return sorted(dirs, key=lambda p: (p.count("/"), p.lower()))


def iter_project_dirs(
    raiz: Path,
    only_under: list[str] | None = None,
    *,
    modo_planilhas: bool = True,
) -> list[str]:
    if modo_planilhas:
        files = iter_upload_files(raiz, only_under, modo_planilhas=True)
        return dirs_para_arquivos(files)
    dirs: list[str] = []
    for dirpath, dirnames, _ in os.walk(raiz):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        if any(part in SKIP_DIRS for part in Path(dirpath).parts):
            continue
        rel = os.path.relpath(dirpath, raiz).replace("\\", "/")
        if rel == ".":
            continue
        if only_under and not _dentro_escopo(rel, only_under):
            continue
        dirs.append(rel)
    dirs.sort(key=lambda p: (p.count("/"), p.lower()))
    return dirs


def ensure_folder_chain(
    raiz: Path,
    rel_paths: list[str],
    folder_map: dict[str, str],
    root_id: str,
    log,
) -> dict[str, str]:
    folder_map = dict(folder_map)
    folder_map.setdefault("", root_id)
    for rel in rel_paths:
        parts = Path(rel).parts
        for i in range(len(parts)):
            partial = "/".join(parts[: i + 1])
            if partial in folder_map:
                continue
            parent_rel = str(Path(partial).parent).replace("\\", "/")
            if parent_rel == ".":
                parent_rel = ""
            parent_id = folder_map[parent_rel]
            name = parts[i]
            folder_id = ensure_folder(name, parent_id)
            folder_map[partial] = folder_id
            log(f"  {partial} -> {folder_id}")
    return folder_map


def find_file_on_drive(name: str, parent_id: str) -> dict | None:
    safe = escape_drive_name(name)
    q = f"name = '{safe}' and trashed = false and '{parent_id}' in parents"
    data = composio_execute(TOOL_FIND_FILE, {"q": q, "pageSize": 5})
    files = data.get("files") or []
    return files[0] if files else None


def file_exists_on_drive(name: str, parent_id: str) -> bool:
    return find_file_on_drive(name, parent_id) is not None


def upload_ou_atualizar(file_path: Path, parent_id: str) -> str:
    """
    Envia planilha ao Drive. Se já existir no mesmo pai, substitui conteúdo.
    Retorna: 'uploaded' | 'updated'.
    """
    existing = find_file_on_drive(file_path.name, parent_id)
    if existing:
        composio_execute(TOOL_DELETE_FILE, {"fileId": existing["id"]})
        time.sleep(0.2)
    composio_execute(
        TOOL_UPLOAD_FILE,
        {"folder_to_upload_to": parent_id},
        file_path=file_path,
    )
    return "updated" if existing else "uploaded"


def create_google_sheet(title: str, folder_id: str) -> dict:
    return composio_execute(
        TOOL_CREATE_SHEET,
        {"title": title, "folder_id": folder_id},
    )


def sync(
    raiz: Path,
    *,
    apenas_pastas: bool = False,
    only_under: list[str] | None = None,
    criar_planilha_vazia: bool = False,
    modo: str = "planilhas",
) -> dict:
    def log(msg: str) -> None:
        print(msg, flush=True)

    raiz = raiz.resolve()
    if not raiz.is_dir():
        raise SystemExit(f"Raiz inválida: {raiz}")

    prior = load_manifest(raiz)
    modo_planilhas = modo != "completo"
    log(f"Raiz local: {raiz}")
    log(f"Modo: {'planilhas (base + exportações BA/SC/JP)' if modo_planilhas else 'completo (espelho legado)'}")
    log(f"Verificando Composio ({COMPOSIO_TOOLKIT})...")
    verificar_conexao_googlesuper()

    log("Pasta raiz no Drive...")
    root_id = prior.get("root_id") or ensure_folder(ROOT_NAME)
    log(f"  {ROOT_NAME} -> {root_id}")

    upload_files = iter_upload_files(raiz, only_under, modo_planilhas=modo_planilhas)
    rel_dirs = dirs_para_arquivos(upload_files) if modo_planilhas else iter_project_dirs(
        raiz, only_under, modo_planilhas=False
    )
    if only_under and not modo_planilhas:
        extra = set()
        for p in only_under:
            parts = Path(p).parts
            for i in range(len(parts)):
                extra.add("/".join(parts[: i + 1]))
        rel_dirs = sorted(extra | set(rel_dirs), key=lambda x: (x.count("/"), x.lower()))

    folder_map = prior.get("folder_map") or {}
    folder_map = ensure_folder_chain(raiz, rel_dirs, folder_map, root_id, log)
    log(f"\nPastas: {len(folder_map)}")
    if modo_planilhas:
        log(f"Planilhas a sincronizar: {len(upload_files)}")

    uploaded = updated = skipped = sheets_created = 0
    if not apenas_pastas:
        for rel_dir, file_path in upload_files:
            parent_id = folder_map.get(rel_dir or "")
            if not parent_id:
                log(f"  SKIP (sem pasta): {file_path.relative_to(raiz)}")
                skipped += 1
                continue
            size = file_path.stat().st_size
            if size > MAX_UPLOAD_BYTES:
                log(f"  SKIP (>5MB): {file_path.relative_to(raiz)}")
                skipped += 1
                continue
            acao = upload_ou_atualizar(file_path, parent_id)
            log(f"  {acao}: {file_path.relative_to(raiz)}")
            if acao == "updated":
                updated += 1
            else:
                uploaded += 1
            time.sleep(0.35)

        if criar_planilha_vazia and only_under:
            for rel in only_under:
                parent_id = folder_map.get(rel)
                if not parent_id:
                    continue
                title = Path(rel).name.title()
                if file_exists_on_drive(f"{title}.gsheet", parent_id):
                    continue
                try:
                    sheet = create_google_sheet(title, parent_id)
                    log(f"  sheet: {rel} -> {sheet.get('spreadsheetUrl') or sheet.get('spreadsheetId')}")
                    sheets_created += 1
                except RuntimeError as exc:
                    log(f"  sheet SKIP {rel}: {exc}")

    manifest = {
        "root_name": ROOT_NAME,
        "root_id": root_id,
        "root_url": f"https://drive.google.com/drive/folders/{root_id}",
        "modo": modo,
        "folders": len(folder_map),
        "uploaded": uploaded,
        "updated": updated,
        "skipped_files": skipped,
        "sheets_created": sheets_created,
        "folder_map": folder_map,
        "synced_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    # Backup automático do manifest antes da gravação final. O decorator
    # injeta o path absoluto do manifest como 1º arg posicional; a função
    # interna delega para save_manifest() preservando sua assinatura pública.
    manifest_abs = raiz / MANIFEST_REL

    @with_backup(manifest_abs)
    def _save_manifest_com_backup(path, manifest_data):
        return save_manifest(raiz, manifest_data)

    out = _save_manifest_com_backup(manifest)
    log(f"\nManifest: {out}")
    log(f"Drive: {manifest['root_url']}")
    return manifest


def escopo_mes(raiz: Path, mes: str, estado: str, ano: int) -> list[str]:
    """Planilhas após processar um mês (base + saídas se prestação está no escopo Drive)."""
    from lib_paths import escopo_prestacao

    escopo = escopo_prestacao(raiz)
    mes_slug, _ = resolver_mes(mes)
    paths = ["", f"{estado}/cadastro"]
    if prestacao_exporta(estado, escopo):
        if escopo:
            paths.extend(
                [
                    f"{estado}/{ano}/{escopo}/{mes_slug}",
                    f"{estado}/{ano}/{escopo}",
                ]
            )
        else:
            paths.extend([f"{estado}/{ano}/{mes_slug}", f"{estado}/{ano}"])
    return paths
