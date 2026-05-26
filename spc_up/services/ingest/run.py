"""Ingest files from disk into movimentacoes."""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from spc_up.config import settings
from spc_up.models.entities import (
    ArquivoIngestao,
    ArquivoIngestaoStatus,
    DiretorioEstadual,
)
from spc_up.services.ingest.excel import parse_excel
from spc_up.services.ingest.ofx import parse_ofx, persist_transactions
from spc_up.services.match.rules import apply_deterministic_match

_SUPPORTED_SUFFIXES = {".ofx", ".xlsx", ".xls"}


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _parse_rows(path: Path) -> list[dict[str, Any]]:
    suffix = path.suffix.lower()
    if suffix == ".ofx":
        return parse_ofx(path)
    if suffix in {".xlsx", ".xls"}:
        return parse_excel(path)
    raise ValueError(f"Unsupported file type: {path.suffix}")


def _resolve_ingest_paths(path: str | Path) -> list[Path]:
    target = Path(path)
    if not target.exists():
        raise FileNotFoundError(f"Path not found: {target}")
    if target.is_file():
        return [target]
    files = sorted(
        p for p in target.iterdir() if p.is_file() and p.suffix.lower() in _SUPPORTED_SUFFIXES
    )
    if not files:
        raise ValueError(f"No ingestable files in {target}")
    return files


def _get_diretorio(session: Session, uf: str) -> DiretorioEstadual:
    diretorio = session.execute(
        select(DiretorioEstadual).where(DiretorioEstadual.uf == uf.upper())
    ).scalar_one_or_none()
    if diretorio is None:
        raise ValueError(f"Diretorio estadual not found for UF={uf}")
    return diretorio


def _store_file(path: Path, uf: str, exercicio: int) -> Path:
    dest_dir = Path(settings.storage_root) / "ingest" / uf.upper() / str(exercicio)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / path.name
    shutil.copy2(path, dest)
    return dest


def ingest_path(
    session: Session,
    uf: str,
    exercicio: int,
    path: str | Path,
) -> tuple[int, int]:
    """Ingest one file or directory of files. Returns (files, movimentacoes)."""
    uf = uf.upper()
    diretorio = _get_diretorio(session, uf)
    files = _resolve_ingest_paths(path)
    total_movimentacoes = 0

    for file_path in files:
        stored = _store_file(file_path, uf, exercicio)
        arquivo = ArquivoIngestao(
            diretorio_estadual_id=diretorio.id,
            uf=uf,
            exercicio=exercicio,
            nome_arquivo=file_path.name,
            hash_arquivo=_file_hash(file_path),
            caminho_storage=str(stored),
            status=ArquivoIngestaoStatus.PROCESSANDO.value,
        )
        session.add(arquivo)
        session.flush()

        try:
            rows = _parse_rows(file_path)
            created = persist_transactions(session, uf, exercicio, arquivo.id, rows)
            for movimentacao in created:
                apply_deterministic_match(session, movimentacao.id)
            arquivo.status = ArquivoIngestaoStatus.CONCLUIDO.value
            total_movimentacoes += len(created)
        except Exception:
            arquivo.status = ArquivoIngestaoStatus.ERRO.value
            raise

    return len(files), total_movimentacoes
