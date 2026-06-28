#!/usr/bin/env python3
"""Resolução de caminhos, estados e pastas mensais — SPCA UP V2."""

from __future__ import annotations

import json
import re
import unicodedata
from fnmatch import fnmatch
from pathlib import Path
from typing import Any

MESES_JSON = Path(__file__).resolve().parent / "meses.json"

MES_NUMERO: dict[str, int] = {
    "janeiro": 1,
    "fevereiro": 2,
    "marco": 3,
    "abril": 4,
    "maio": 5,
    "junho": 6,
    "julho": 7,
    "agosto": 8,
    "setembro": 9,
    "outubro": 10,
    "novembro": 11,
    "dezembro": 12,
}

MES_ABREV: dict[str, str] = {
    "janeiro": "jan",
    "fevereiro": "fev",
    "marco": "mar",
    "abril": "abr",
    "maio": "mai",
    "junho": "jun",
    "julho": "jul",
    "agosto": "ago",
    "setembro": "set",
    "outubro": "out",
    "novembro": "nov",
    "dezembro": "dez",
}

# Layout A — fontes planas + saídas em {ano}/mensal/{mes}-arquivo
PASTA_FONTES = "fontes"
PASTA_MENSAL = "mensal"
PASTA_CACHE = ".cache"


def numero_mes_civil(slug: str) -> int:
    chave, _ = resolver_mes(slug)
    return MES_NUMERO[chave]


ESTADOS: dict[str, tuple[str, str]] = {
    "AC": ("Acre", "pessoas acre.xlsx"),
    "AL": ("Alagoas", "pessoas alagoas.xlsx"),
    "AP": ("Amapá", "pessoas amapa.xlsx"),
    "AM": ("Amazonas", "pessoas amazonas.xlsx"),
    "BA": ("Bahia", "pessoas bahia.xlsx"),
    "CE": ("Ceará", "pessoas ceara.xlsx"),
    "DF": ("Distrito Federal", "pessoas distrito federal.xlsx"),
    "ES": ("Espírito Santo", "pessoas espirito santo.xlsx"),
    "GO": ("Goiás", "pessoas goias.xlsx"),
    "MA": ("Maranhão", "pessoas maranhao.xlsx"),
    "MT": ("Mato Grosso", "pessoas mato grosso.xlsx"),
    "MS": ("Mato Grosso do Sul", "pessoas mato grosso do sul.xlsx"),
    "MG": ("Minas Gerais", "pessoas minas gerais.xlsx"),
    "PA": ("Pará", "pessoas para.xlsx"),
    "PB": ("Paraíba", "pessoas paraiba.xlsx"),
    "PR": ("Paraná", "pessoas parana.xlsx"),
    "PE": ("Pernambuco", "pessoas pernambuco.xlsx"),
    "PI": ("Piauí", "pessoas piaui.xlsx"),
    "RJ": ("Rio de Janeiro", "pessoas rio de janeiro.xlsx"),
    "RN": ("Rio Grande do Norte", "pessoas rio grande do norte.xlsx"),
    "RS": ("Rio Grande do Sul", "pessoas rio grande do sul.xlsx"),
    "RO": ("Rondônia", "pessoas rondonia.xlsx"),
    "RR": ("Roraima", "pessoas roraima.xlsx"),
    "SC": ("Santa Catarina", "pessoas santa catarina.xlsx"),
    "SP": ("São Paulo", "pessoas sao paulo.xlsx"),
    "SE": ("Sergipe", "pessoas sergipe.xlsx"),
    "TO": ("Tocantins", "pessoas tocantins.xlsx"),
}

ALIASES_ESTADO: dict[str, str] = {
    "BAHIA": "BA",
    "SAO PAULO": "SP",
    "SÃO PAULO": "SP",
    "RIO DE JANEIRO": "RJ",
    "MINAS GERAIS": "MG",
    "DISTRITO FEDERAL": "DF",
}


def strip_accents(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def normalizar_chave(text: str) -> str:
    return strip_accents(text.strip().lower())


def carregar_meses() -> dict[str, dict[str, str]]:
    return json.loads(MESES_JSON.read_text(encoding="utf-8"))


def resolver_mes(slug: str) -> tuple[str, dict[str, str]]:
    """Retorna (slug, config do mês com nome canônico)."""
    meses = carregar_meses()
    chave = normalizar_chave(slug)
    aliases = {"março": "marco", "march": "marco"}
    chave = aliases.get(chave, chave)
    if chave not in meses:
        opcoes = ", ".join(sorted(meses))
        raise SystemExit(f"Mês inválido: {slug}. Use: {opcoes}")
    cfg = meses[chave]
    if isinstance(cfg, str):
        cfg = {"nome": cfg}
    return chave, cfg


def nome_mes_canonico(cfg_mes: dict[str, str]) -> str:
    return cfg_mes["nome"]


def normalizar_uf(estado: str) -> str:
    texto = estado.strip().upper()
    if len(texto) == 2 and texto in ESTADOS:
        return texto
    chave = strip_accents(estado.strip().upper())
    if chave in ALIASES_ESTADO:
        return ALIASES_ESTADO[chave]
    for uf, (nome, _) in ESTADOS.items():
        if chave == strip_accents(nome.upper()):
            return uf
    raise ValueError(f"Estado inválido: {estado}. Informe UF (ex: BA) ou nome (ex: Bahia).")


def nome_estado(uf: str) -> str:
    return ESTADOS[uf][0]


def raiz_projeto(explicita: Path | None = None) -> Path:
    if explicita:
        return explicita.resolve()
    return Path.cwd().resolve()


def caminho_prestacao_atual(raiz: Path) -> Path:
    return raiz / "resultados" / "prestacao.json"


def escopo_prestacao(raiz: Path) -> str | None:
    """Escopo municipal (ex.: joao-pessoa) definido em prestacao.json."""
    prestacao = carregar_prestacao(raiz)
    if not prestacao:
        return None
    escopo = prestacao.get("escopo")
    return str(escopo).strip() if escopo else None


def pasta_ano_prestacao(raiz: Path, prestacao: dict[str, Any]) -> Path:
    """Raiz das saídas anuais — inclui escopo municipal quando houver."""
    estado = prestacao.get("estado") or nome_estado(prestacao["estado_uf"])
    base = raiz / estado / str(int(prestacao["ano"]))
    escopo = prestacao.get("escopo")
    if escopo:
        return base / str(escopo).strip()
    return base


def arquivo_mes(mes_slug: str, nome_arquivo: str) -> str:
    """Nome flat em mensal/: janeiro-Exportacao_Mensal.xlsx"""
    return f"{mes_slug}-{nome_arquivo}"


def dir_saida_mensal(raiz: Path, estado: str, ano: int, escopo: str | None = None) -> Path:
    """Pasta única de saídas mensais: {Estado}/{ano}/mensal/ ou …/{escopo}/mensal/."""
    base = raiz / estado / str(ano)
    if escopo:
        return base / escopo / PASTA_MENSAL
    return base / PASTA_MENSAL


def dir_saida_mes(raiz: Path, estado: str, ano: int, mes_slug: str, escopo: str | None = None) -> Path:
    """Compat: retorna pasta mensal flat (não mais subpasta por mês)."""
    return dir_saida_mensal(raiz, estado, ano, escopo)


def caminho_arquivo_mensal(pasta_ano: Path, mes_slug: str, nome_arquivo: str) -> Path:
    """Caminho de escrita no layout A."""
    return pasta_ano / PASTA_MENSAL / arquivo_mes(mes_slug, nome_arquivo)


def resolver_arquivo_mensal(pasta_ano: Path, mes_slug: str, nome_arquivo: str) -> Path | None:
    """Lê layout A; fallback legado {ano}/{mes}/arquivo."""
    novo = caminho_arquivo_mensal(pasta_ano, mes_slug, nome_arquivo)
    if novo.is_file():
        return novo
    legado = pasta_ano / mes_slug / nome_arquivo
    if legado.is_file():
        return legado
    return None


def resolver_pasta_fontes(raiz: Path, nome_estado: str) -> Path | None:
    """
    Pasta plana de PDFs (layout A).
    Prioridade: base_prestacao/fontes → {Estado}/fontes → base_prestacao se já for fontes.
    """
    prestacao_file = caminho_prestacao_atual(raiz)
    if prestacao_file.is_file():
        dados = json.loads(prestacao_file.read_text(encoding="utf-8"))
        if dados.get("estado") == nome_estado:
            rel = dados.get("base_prestacao")
            if rel:
                base = raiz / rel
                if base.name == PASTA_FONTES and base.is_dir():
                    return base
                fontes = base / PASTA_FONTES
                if fontes.is_dir():
                    return fontes
                if base.is_dir() and _pasta_eh_fontes_plana(base):
                    return base

    candidato = raiz / nome_estado / PASTA_FONTES
    if candidato.is_dir():
        return candidato
    return None


def _pasta_eh_fontes_plana(pasta: Path) -> bool:
    """True se não usa subpastas Extrato total / Estadual / Extratos."""
    if not pasta.is_dir():
        return False
    if (pasta / "Extrato total").is_dir():
        return False
    if (pasta / "Estadual").is_dir():
        return False
    if (pasta / "Extratos").is_dir():
        return False
    return bool(listar_pdfs(pasta))


def descobrir_base_prestacao(raiz: Path, nome_estado: str) -> Path:
    """
    Localiza pasta de fontes do estado (layout A ou legado).
    Prioridade:
      1. resolver_pasta_fontes() (layout A)
      2. prestacao.json → base_prestacao
      3. {Estado}/Prestação de contas*
      4. {Estado}/ (raiz do estado)
    """
    fontes = resolver_pasta_fontes(raiz, nome_estado)
    if fontes:
        return fontes

    prestacao_file = caminho_prestacao_atual(raiz)
    if prestacao_file.is_file():
        dados = json.loads(prestacao_file.read_text(encoding="utf-8"))
        if dados.get("estado") == nome_estado:
            rel = dados.get("base_prestacao")
            if rel:
                candidato = raiz / rel
                if candidato.is_dir():
                    return candidato

    pasta_estado = raiz / nome_estado
    if pasta_estado.is_dir():
        for sub in sorted(pasta_estado.iterdir()):
            if sub.is_dir() and "prest" in normalizar_chave(sub.name):
                return sub

    if pasta_estado.is_dir():
        return pasta_estado

    raise FileNotFoundError(f"Pasta do estado não encontrada: {pasta_estado}")


def achar_pasta_mes(pasta_pai: Path, mes_canonico: str) -> Path | None:
    """Encontra subpasta do mês (tolera JANEIRO, julho, MARÇO, etc.)."""
    if not pasta_pai.is_dir():
        return None
    alvo = normalizar_chave(mes_canonico)
    for sub in pasta_pai.iterdir():
        if sub.is_dir() and normalizar_chave(sub.name) == alvo:
            return sub
    return None


def listar_pdfs(pasta: Path) -> list[Path]:
    if not pasta.is_dir():
        return []
    return sorted(p for p in pasta.iterdir() if p.suffix.lower() == ".pdf")


MES_ABREV_2: dict[str, str] = {
    "abril": "ab",
    "agosto": "ag",
}


def tokens_mes_arquivo(mes_slug: str, mes_canonico: str) -> set[str]:
    tokens = {normalizar_chave(mes_canonico), mes_slug}
    abrev = MES_ABREV.get(mes_slug)
    if abrev:
        tokens.add(abrev)
    abrev2 = MES_ABREV_2.get(mes_slug)
    if abrev2:
        tokens.add(abrev2)
    if mes_slug == "fevereiro":
        tokens.add("fvereiro")  # typo comum em PDFs JP
    return {t for t in tokens if t}


def achar_pdf_por_mes(pasta: Path, mes_slug: str, mes_canonico: str, ano: int) -> Path | None:
    if not pasta.is_dir():
        return None
    tokens = tokens_mes_arquivo(mes_slug, mes_canonico)
    ano_s = str(ano)
    ano_curto = ano_s[2:]
    candidatos: list[Path] = []
    for pdf in sorted(pasta.glob("*.pdf")):
        nome = normalizar_chave(pdf.stem)
        if not any(tok in nome for tok in tokens):
            continue
        if ano_s not in nome and ano_curto not in nome:
            continue
        candidatos.append(pdf)
    if not candidatos:
        return None
    if len(candidatos) == 1:
        return candidatos[0]
    return sorted(
        candidatos,
        key=lambda p: (
            0 if "cg" in normalizar_chave(p.stem) else 1,
            len(p.name),
            p.name,
        ),
    )[0]


def _pdfs_mes_em_pasta(pasta: Path, mes_slug: str, mes_canonico: str, ano: int) -> list[Path]:
    if not pasta.is_dir():
        return []
    tokens = tokens_mes_arquivo(mes_slug, mes_canonico)
    ano_s = str(ano)
    ano_curto = ano_s[2:]
    out: list[Path] = []
    for pdf in sorted(pasta.glob("*.pdf")):
        nome = normalizar_chave(pdf.stem)
        if not any(tok in nome for tok in tokens):
            continue
        if ano_s not in nome and ano_curto not in nome:
            continue
        out.append(pdf)
    return out


def achar_pdf_fontes(
    pasta: Path,
    mes_slug: str,
    mes_canonico: str,
    ano: int,
    *,
    papel: str,
) -> Path | None:
    """
    Localiza PDF em fontes/ plana.
    papel: total | pix | unificado (BB — um PDF por mês).
    """
    candidatos = _pdfs_mes_em_pasta(pasta, mes_slug, mes_canonico, ano)
    if not candidatos:
        return None

    if papel == "unificado":
        sem_tipo = [
            p
            for p in candidatos
            if "total" not in normalizar_chave(p.stem)
            and "ordinario" not in normalizar_chave(p.stem)
            and "pix" not in normalizar_chave(p.stem)
        ]
        pool = sem_tipo or candidatos
        if len(pool) == 1:
            return pool[0]
        return sorted(pool, key=lambda p: (len(p.name), p.name))[0]

    if papel == "total":
        com_total = [
            p
            for p in candidatos
            if any(m in normalizar_chave(p.stem) for m in ("total", "ordinario", "extrato"))
            and "pix" not in normalizar_chave(p.stem)
        ]
        if com_total:
            return sorted(com_total, key=lambda p: (len(p.name), p.name))[0]
        if len(candidatos) == 1:
            return candidatos[0]
        return None

    # pix
    com_pix = [p for p in candidatos if "pix" in normalizar_chave(p.stem)]
    if com_pix:
        return sorted(com_pix, key=lambda p: (len(p.name), p.name))[0]
    return None


def achar_planilhado_fontes(
    pasta: Path,
    mes_slug: str,
    mes_canonico: str,
    ano: int,
) -> Path | None:
    if not pasta.is_dir():
        return None
    tokens = tokens_mes_arquivo(mes_slug, mes_canonico)
    ano_s = str(ano)
    ano_curto = ano_s[2:]
    candidatos: list[Path] = []
    for arq in listar_arquivos_dados(pasta):
        nome = normalizar_chave(arq.stem)
        if not any(tok in nome for tok in tokens):
            continue
        if ano_s not in nome and ano_curto not in nome:
            continue
        if "pix" in nome or "planilhado" in nome:
            candidatos.append(arq)
    if not candidatos:
        return None
    if len(candidatos) == 1:
        return candidatos[0]
    return sorted(candidatos, key=lambda p: (len(p.name), p.name))[0]


def achar_subpasta_plana(pasta_pai: Path) -> Path | None:
    """Subpasta com PDFs mensais nomeados (ex.: ORDINÁRIO, PIX)."""
    if not pasta_pai.is_dir():
        return None
    subs = [s for s in pasta_pai.iterdir() if s.is_dir()]
    if len(subs) == 1:
        return subs[0]
    for sub in subs:
        if listar_pdfs(sub):
            chave = normalizar_chave(sub.name)
            if chave in ("ordinario", "pix", "estadual"):
                return sub
    return None


def resolver_pasta_mes_caixa(
    pasta_raiz: Path,
    mes_slug: str,
    mes_canonico: str,
    ano: int,
) -> tuple[Path | None, list[Path]]:
    """
    Layout padrão: Extrato total/{Mês}/.
    Layout plano: Extrato total/ORDINÁRIO/{Mês} Ordinário 25.pdf.
    """
    pasta_mes = achar_pasta_mes(pasta_raiz, mes_canonico)
    if pasta_mes:
        return pasta_mes, listar_pdfs(pasta_mes)

    sub = achar_subpasta_plana(pasta_raiz)
    if sub:
        pdf = achar_pdf_por_mes(sub, mes_slug, mes_canonico, ano)
        return sub, [pdf] if pdf else []

    pdf = achar_pdf_por_mes(pasta_raiz, mes_slug, mes_canonico, ano)
    if pdf:
        return pasta_raiz, [pdf]
    return None, []


MODELO_CAIXA_1 = "caixa_1"
MODELO_BB_UNIFICADO = "bb_unificado"
ALIASES_MODELO_EXTRATO: dict[str, str] = {
    "bahia": MODELO_CAIXA_1,  # legado
}


def normalizar_modelo_extrato(modelo: str | None) -> str:
    if not modelo:
        return MODELO_CAIXA_1
    return ALIASES_MODELO_EXTRATO.get(modelo, modelo)


def detectar_modelo_extrato(raiz: Path, base: Path) -> str:
    """caixa_1 = total+PIX separados; bb_unificado = extrato BB com nome na mesma linha."""
    if base.name == PASTA_FONTES or _pasta_eh_fontes_plana(base):
        pdfs = listar_pdfs(base)
        if pdfs:
            nomes = " ".join(normalizar_chave(p.stem) for p in pdfs[:20])
            if "total" in nomes and "pix" in nomes:
                return MODELO_CAIXA_1
        return MODELO_BB_UNIFICADO
    if (base / "Estadual").is_dir():
        return MODELO_BB_UNIFICADO
    try:
        base_rel = str(base.relative_to(raiz))
    except ValueError:
        base_rel = str(base)
    prestacao = carregar_prestacao(raiz)
    if (
        prestacao
        and prestacao.get("modelo_extrato")
        and prestacao.get("base_prestacao") == base_rel
    ):
        return normalizar_modelo_extrato(str(prestacao["modelo_extrato"]))
    return MODELO_CAIXA_1


def achar_pdf_estadual(pasta_estadual: Path, mes_slug: str, ano: int) -> Path | None:
    """Localiza PDF mensal no layout Estadual (ex.: 648 jan 2025.pdf)."""
    if not pasta_estadual.is_dir():
        return None
    abrev = MES_ABREV.get(mes_slug, mes_slug[:3])
    ano_s = str(ano)
    candidatos: list[Path] = []
    for pdf in pasta_estadual.glob("*.pdf"):
        nome = normalizar_chave(pdf.stem)
        if abrev not in nome:
            continue
        if ano_s not in nome and ano_s[2:] not in nome:
            continue
        candidatos.append(pdf)
    if not candidatos:
        return None
    if len(candidatos) == 1:
        return candidatos[0]
    # Preferir nome mais curto (evita duplicata jun 22025(1))
    return sorted(candidatos, key=lambda p: (len(p.name), p.name))[0]


def resolver_fontes_mes_extratos(
    raiz: Path,
    uf: str,
    mes_slug: str,
    ano: int,
    *,
    base: Path,
    slug: str,
    mes_cfg: dict[str, str],
    mes_canonico: str,
    nome: str,
) -> dict[str, Any]:
    """Layout municipal Caixa: Extratos/JAN 0125 CG.pdf (um PDF por mês)."""
    pasta_extratos = base / "Extratos"
    pdf = achar_pdf_por_mes(pasta_extratos, slug, mes_canonico, ano)
    if not pdf:
        raise FileNotFoundError(
            f"PDF Extratos não encontrado para {mes_canonico}/{ano} em `{pasta_extratos}` "
            f"(ex.: JAN 0125 CG.pdf, AB 0425 CG.pdf)."
        )

    path_pessoas: Path | None
    try:
        path_pessoas = resolver_cadastro(raiz, uf, base)
    except FileNotFoundError:
        path_pessoas = None

    pdf_pessoas = None
    for candidato in (base / "pessoas.pdf", raiz / nome / "pessoas.pdf"):
        if candidato.is_file():
            pdf_pessoas = candidato
            break

    escopo = escopo_prestacao(raiz)
    output_dir = dir_saida_mensal(raiz, nome, ano, escopo)
    cache_dir = dir_cache_mes(raiz, nome, ano, slug, escopo)

    return {
        "raiz": raiz,
        "mes_slug": slug,
        "mes_nome": mes_canonico,
        "mes_cfg": mes_cfg,
        "estado": nome,
        "estado_uf": uf,
        "ano": ano,
        "escopo": escopo,
        "base_prestacao": base,
        "modelo_extrato": MODELO_CAIXA_1,
        "path_total": None,
        "path_pix": None,
        "path_pessoas": path_pessoas,
        "pdf_pessoas": pdf_pessoas,
        "output_dir": output_dir,
        "cache_dir": cache_dir,
        "pasta_total": pasta_extratos,
        "pasta_pix": pasta_extratos,
        "pasta_planilhado": None,
        "pdfs_total": [str(pdf)],
        "pdfs_pix": [str(pdf)],
        "usa_nlm": True,
        "tem_csv_direto": False,
    }


def resolver_fontes_mes_bb_unificado(
    raiz: Path,
    uf: str,
    mes_slug: str,
    ano: int,
    *,
    base: Path,
    slug: str,
    mes_cfg: dict[str, str],
    mes_canonico: str,
    nome: str,
) -> dict[str, Any]:
    pasta_estadual = base / "Estadual"
    pdf = achar_pdf_estadual(pasta_estadual, slug, ano)
    if not pdf:
        raise FileNotFoundError(
            f"PDF Estadual não encontrado para {mes_canonico}/{ano} em `{pasta_estadual}` "
            f"(esperado padrão tipo `648 {MES_ABREV.get(slug, slug)} {ano}.pdf`)."
        )

    path_pessoas: Path | None
    try:
        path_pessoas = resolver_cadastro(raiz, uf, base)
    except FileNotFoundError:
        path_pessoas = None

    pdf_pessoas = None
    for candidato in (base / "pessoas.pdf", raiz / nome / "pessoas.pdf"):
        if candidato.is_file():
            pdf_pessoas = candidato
            break

    escopo = escopo_prestacao(raiz)
    output_dir = dir_saida_mensal(raiz, nome, ano, escopo)
    cache_dir = dir_cache_mes(raiz, nome, ano, slug, escopo)

    return {
        "raiz": raiz,
        "mes_slug": slug,
        "mes_nome": mes_canonico,
        "mes_cfg": mes_cfg,
        "estado": nome,
        "estado_uf": uf,
        "ano": ano,
        "escopo": escopo,
        "base_prestacao": base,
        "modelo_extrato": "bb_unificado",
        "path_total": None,
        "path_pix": None,
        "path_pessoas": path_pessoas,
        "pdf_pessoas": pdf_pessoas,
        "output_dir": output_dir,
        "cache_dir": cache_dir,
        "pasta_total": pasta_estadual,
        "pasta_pix": pasta_estadual,
        "pasta_planilhado": None,
        "pdfs_total": [str(pdf)],
        "pdfs_pix": [str(pdf)],
        "usa_nlm": True,
        "tem_csv_direto": False,
    }


def dir_cache_mes(
    raiz: Path,
    estado: str,
    ano: int,
    mes_slug: str,
    escopo: str | None = None,
) -> Path:
    return dir_saida_mensal(raiz, estado, ano, escopo) / PASTA_CACHE / mes_slug


def exportar_cadastro_csv(caminho_xlsx: Path, destino: Path) -> Path:
    """Exporta cadastro XLSX para CSV auxiliar do NotebookLM."""
    import re

    import openpyxl

    wb = openpyxl.load_workbook(caminho_xlsx, read_only=True, data_only=True)
    ws = wb.active
    linhas = ["tipo,documento,nome"]
    for row in ws.iter_rows(values_only=True):
        if not row or not row[0]:
            continue
        nome = str(row[0]).strip().replace('"', '""')
        doc = re.sub(r"\D", "", str(row[1] or ""))
        tipo = str(row[2] or "").strip() if len(row) > 2 else ""
        linhas.append(f'{tipo},{doc},"{nome}"')
    wb.close()
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text("\n".join(linhas) + "\n", encoding="utf-8")
    return destino


def achar_arquivo_opcional(
    pasta: Path,
    patterns: list[str],
) -> Path | None:
    arquivos = listar_arquivos_dados(pasta)
    if not arquivos:
        return None
    for pat in patterns:
        for arq in arquivos:
            nome = arq.name.lower()
            if fnmatch(nome, pat) or pat in nome:
                return arq
    if len(arquivos) == 1:
        return arquivos[0]
    return None


def listar_arquivos_dados(pasta: Path) -> list[Path]:
    if not pasta.is_dir():
        return []
    out: list[Path] = []
    for ext in ("*.csv", "*.xlsx", "*.xls"):
        out.extend(sorted(pasta.glob(ext)))
    return out


def achar_arquivo(
    pasta: Path,
    patterns: list[str],
    rotulo: str,
) -> Path:
    arquivos = listar_arquivos_dados(pasta)
    if not arquivos:
        raise FileNotFoundError(
            f"{rotulo}: nenhum CSV/XLSX em `{pasta}`. "
            "Converta o PDF antes de processar."
        )
    for pat in patterns:
        for arq in arquivos:
            nome = arq.name.lower()
            if fnmatch(nome, pat) or pat in nome:
                return arq
    if len(arquivos) == 1:
        return arquivos[0]
    nomes = ", ".join(a.name for a in arquivos)
    raise FileNotFoundError(
        f"{rotulo}: múltiplos arquivos em `{pasta}` ({nomes}). "
        f"Esperado padrão: {patterns}"
    )


def resolver_cadastro(raiz: Path, uf: str, base_prestacao: Path) -> Path:
    """Cadastro em {Estado}/cadastro/ ou pessoas.* na base de prestação."""
    nome = nome_estado(uf)
    _, arquivo_cadastro = ESTADOS[uf]

    pasta_cadastro = raiz / nome / "cadastro"
    if pasta_cadastro.is_dir():
        for arq in sorted(pasta_cadastro.glob("*.xlsx")):
            if arq.name.lower() in (arquivo_cadastro.lower(), "pessoas.xlsx", "pessoas.csv"):
                return arq
        xlsx = list(pasta_cadastro.glob("*.xlsx"))
        if len(xlsx) == 1:
            return xlsx[0]
        csvs = list(pasta_cadastro.glob("*.csv"))
        if len(csvs) == 1:
            return csvs[0]

    for nome_arq in ("pessoas.xlsx", "pessoas.csv", "pessoas.xls"):
        candidato = base_prestacao / nome_arq
        if candidato.is_file():
            return candidato

    candidato_estado = raiz / nome / "pessoas.xlsx"
    if candidato_estado.is_file():
        return candidato_estado

    raise FileNotFoundError(
        f"Cadastro não encontrado para {nome} ({uf}). "
        f"Esperado `{nome}/cadastro/{arquivo_cadastro}` ou `{base_prestacao}/pessoas.xlsx`."
    )


def resolver_fontes_mes_fontes(
    raiz: Path,
    uf: str,
    mes_slug: str,
    ano: int,
    *,
    pasta_fontes: Path,
    slug: str,
    mes_cfg: dict[str, str],
    mes_canonico: str,
    nome: str,
) -> dict[str, Any]:
    """Layout A: PDFs planos em fontes/ (ex.: 2025-01-total.pdf, 2025-01-pix.pdf)."""
    pdf_total = achar_pdf_fontes(pasta_fontes, slug, mes_canonico, ano, papel="total")
    pdf_pix = achar_pdf_fontes(pasta_fontes, slug, mes_canonico, ano, papel="pix")
    pdf_uni = achar_pdf_fontes(pasta_fontes, slug, mes_canonico, ano, papel="unificado")
    planilhado = achar_planilhado_fontes(pasta_fontes, slug, mes_canonico, ano)

    modelo = MODELO_CAIXA_1
    if pdf_uni and not pdf_total:
        pdf_total = pdf_pix = pdf_uni
        modelo = MODELO_BB_UNIFICADO
    elif not pdf_total and pdf_uni:
        pdf_total = pdf_pix = pdf_uni
        modelo = MODELO_BB_UNIFICADO

    if not pdf_total:
        raise FileNotFoundError(
            f"PDF total não encontrado em `{pasta_fontes}` para {mes_canonico}/{ano}. "
            f"Use ex.: `{ano}-{slug}-total.pdf` ou `648 {MES_ABREV.get(slug, slug)} {ano}.pdf`."
        )
    if not pdf_pix and not planilhado and modelo == MODELO_CAIXA_1:
        raise FileNotFoundError(
            f"PDF PIX ou planilhado não encontrado em `{pasta_fontes}` para {mes_canonico}/{ano}. "
            f"Use ex.: `{ano}-{slug}-pix.pdf`."
        )

    path_pessoas: Path | None
    try:
        path_pessoas = resolver_cadastro(raiz, uf, pasta_fontes)
    except FileNotFoundError:
        path_pessoas = None

    pdf_pessoas = None
    for candidato in (pasta_fontes / "pessoas.pdf", raiz / nome / "pessoas.pdf"):
        if candidato.is_file():
            pdf_pessoas = candidato
            break

    escopo = escopo_prestacao(raiz)
    output_dir = dir_saida_mensal(raiz, nome, ano, escopo)
    cache_dir = dir_cache_mes(raiz, nome, ano, slug, escopo)

    pdfs_total = [str(pdf_total)]
    pdfs_pix = [str(pdf_pix)] if pdf_pix else []

    path_total = achar_arquivo_opcional(
        pasta_fontes,
        ["*total*", "extrato*total*", "extrato_total*", "*ordinario*"],
    )
    path_pix = None
    if pdf_pix:
        path_pix = achar_arquivo_opcional(pasta_fontes, ["*pix*", "extrato*pix*"])

    return {
        "raiz": raiz,
        "mes_slug": slug,
        "mes_nome": mes_canonico,
        "mes_cfg": mes_cfg,
        "estado": nome,
        "estado_uf": uf,
        "ano": ano,
        "escopo": escopo,
        "base_prestacao": pasta_fontes,
        "modelo_extrato": modelo,
        "path_total": path_total,
        "path_pix": path_pix,
        "path_pessoas": path_pessoas,
        "pdf_pessoas": pdf_pessoas,
        "output_dir": output_dir,
        "cache_dir": cache_dir,
        "pasta_total": pasta_fontes,
        "pasta_pix": pasta_fontes,
        "pasta_planilhado": planilhado,
        "pdfs_total": pdfs_total,
        "pdfs_pix": pdfs_pix,
        "usa_nlm": not path_total or (not path_pix and not planilhado),
        "tem_csv_direto": bool(path_total and (path_pix or path_pessoas)),
    }


def resolver_fontes_mes(
    raiz: Path,
    uf: str,
    mes_slug: str,
    ano: int,
) -> dict[str, Any]:
    """Resolve pastas, PDFs e arquivos opcionais (CSV/XLSX) para o mês."""
    slug, mes_cfg = resolver_mes(mes_slug)
    mes_canonico = nome_mes_canonico(mes_cfg)
    nome = nome_estado(uf)

    pasta_fontes = resolver_pasta_fontes(raiz, nome)
    if pasta_fontes:
        return resolver_fontes_mes_fontes(
            raiz, uf, mes_slug, ano,
            pasta_fontes=pasta_fontes,
            slug=slug, mes_cfg=mes_cfg, mes_canonico=mes_canonico, nome=nome,
        )

    base = descobrir_base_prestacao(raiz, nome)
    if (base / "Extratos").is_dir() and not (base / "Estadual").is_dir():
        return resolver_fontes_mes_extratos(
            raiz, uf, mes_slug, ano,
            base=base, slug=slug, mes_cfg=mes_cfg, mes_canonico=mes_canonico, nome=nome,
        )
    modelo = detectar_modelo_extrato(raiz, base)
    if modelo == MODELO_BB_UNIFICADO:
        return resolver_fontes_mes_bb_unificado(
            raiz, uf, mes_slug, ano,
            base=base, slug=slug, mes_cfg=mes_cfg, mes_canonico=mes_canonico, nome=nome,
        )

    pasta_total, pdfs_total_list = resolver_pasta_mes_caixa(
        base / "Extrato total", slug, mes_canonico, ano
    )
    pasta_pix, pdfs_pix_list = resolver_pasta_mes_caixa(
        base / "Extrato total PIX", slug, mes_canonico, ano
    )
    pasta_planilhado = achar_pasta_mes(base / "Planilhado", mes_canonico)

    if not pasta_total:
        raise FileNotFoundError(
            f"Extrato total não encontrado: `{base / 'Extrato total' / mes_canonico}` "
            f"nem PDF mensal em subpasta plana (ex.: ORDINÁRIO)."
        )
    if not pasta_pix and not pasta_planilhado and not pdfs_pix_list:
        raise FileNotFoundError(
            f"Extrato PIX ou Planilhado não encontrado para `{mes_canonico}`"
        )

    path_total = achar_arquivo_opcional(
        pasta_total,
        ["*total*", "extrato*total*", "extrato_total*", "*extrato*", "*ordinario*"],
    )
    path_pix = None
    if pasta_pix:
        path_pix = achar_arquivo_opcional(
            pasta_pix,
            ["*pix*", "extrato*pix*", "*extrato*"],
        )

    path_pessoas: Path | None
    try:
        path_pessoas = resolver_cadastro(raiz, uf, base)
    except FileNotFoundError:
        path_pessoas = None

    pdf_pessoas = None
    for candidato in (base / "pessoas.pdf", raiz / nome / "pessoas.pdf"):
        if candidato.is_file():
            pdf_pessoas = candidato
            break

    escopo = escopo_prestacao(raiz)
    output_dir = dir_saida_mensal(raiz, nome, ano, escopo)
    cache_dir = dir_cache_mes(raiz, nome, ano, slug, escopo)

    pdfs_total = pdfs_total_list or listar_pdfs(pasta_total)
    pdfs_pix = pdfs_pix_list or (listar_pdfs(pasta_pix) if pasta_pix else [])

    usa_nlm = not path_total or (not path_pix and not pasta_planilhado)

    return {
        "raiz": raiz,
        "mes_slug": slug,
        "mes_nome": mes_canonico,
        "mes_cfg": mes_cfg,
        "estado": nome,
        "estado_uf": uf,
        "ano": ano,
        "escopo": escopo,
        "base_prestacao": base,
        "path_total": path_total,
        "path_pix": path_pix,
        "path_pessoas": path_pessoas,
        "pdf_pessoas": pdf_pessoas,
        "output_dir": output_dir,
        "cache_dir": cache_dir,
        "pasta_total": pasta_total,
        "pasta_pix": pasta_pix,
        "pasta_planilhado": pasta_planilhado,
        "pdfs_total": [str(p) for p in pdfs_total],
        "pdfs_pix": [str(p) for p in pdfs_pix],
        "usa_nlm": usa_nlm or bool(pdfs_total or pdfs_pix),
        "tem_csv_direto": bool(path_total and (path_pix or path_pessoas)),
    }


def resolver_arquivos_mes(
    raiz: Path,
    uf: str,
    mes_slug: str,
    ano: int,
) -> dict[str, Any]:
    paths = resolver_fontes_mes(raiz, uf, mes_slug, ano)

    if paths["path_total"] and paths["path_pix"] and paths["path_pessoas"]:
        return paths

    if paths["usa_nlm"]:
        raise FileNotFoundError(
            "Entrada CSV/XLSX incompleta. Use processar_mes.py (extrai via NotebookLM) "
            f"ou coloque arquivos em `{paths['pasta_total']}` e cadastro."
        )

    if not paths["path_total"]:
        raise FileNotFoundError(
            f"Extrato total: nenhum CSV/XLSX em `{paths['pasta_total']}`. "
            "Execute extração NLM ou converta o PDF."
        )
    if not paths["path_pix"]:
        raise FileNotFoundError(
            f"Extrato PIX: nenhum CSV/XLSX em `{paths['pasta_pix']}`. "
            "Use Planilhado, NLM ou converta o PDF."
        )
    paths["path_pessoas"] = resolver_cadastro(raiz, uf, paths["base_prestacao"])
    return paths


def _relativo(caminho: Path, raiz: Path) -> str:
    try:
        return str(caminho.relative_to(raiz))
    except ValueError:
        return str(caminho)


def carregar_prestacao(raiz: Path) -> dict[str, Any] | None:
    caminho = caminho_prestacao_atual(raiz)
    if not caminho.is_file():
        return None
    return json.loads(caminho.read_text(encoding="utf-8"))
