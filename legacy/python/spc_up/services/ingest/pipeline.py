"""Shared ingest pipeline for CLI and API."""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from spc_up.config import settings
from spc_up.models.entities import (
    ArquivoIngestao,
    ArquivoIngestaoStatus,
    DiretorioEstadual,
    Movimentacao,
)
from spc_up.services.ingest.excel import parse_excel
from spc_up.services.ingest.ofx import parse_ofx, persist_transactions
from spc_up.services.match.rules import apply_deterministic_match

INGEST_EXTENSIONS = {".ofx", ".xlsx", ".xls"}


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def store_upload(path: Path, uf: str, exercicio: int) -> Path:
    dest_dir = Path(settings.storage_root) / uf.upper() / str(exercicio)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / path.name
    shutil.copy2(path, dest)
    return dest


def parse_ingest_file(path: Path) -> list[dict]:
    suffix = path.suffix.lower()
    if suffix == ".ofx":
        return parse_ofx(path)
    if suffix in {".xlsx", ".xls"}:
        return parse_excel(path)
    raise ValueError(f"Formato não suportado: {path.suffix}")


def get_diretorio(session: Session, uf: str) -> DiretorioEstadual | None:
    return session.scalar(select(DiretorioEstadual).where(DiretorioEstadual.uf == uf.upper()))


def ingest_file(
    session: Session,
    *,
    diretorio: DiretorioEstadual,
    uf: str,
    exercicio: int,
    source: Path,
) -> list[Movimentacao]:
    """Parse file, persist movimentações, run deterministic match."""
    stored = store_upload(source, uf, exercicio)
    arquivo = ArquivoIngestao(
        diretorio_estadual_id=diretorio.id,
        uf=uf.upper(),
        exercicio=exercicio,
        nome_arquivo=source.name,
        hash_arquivo=file_hash(source),
        caminho_storage=str(stored),
        status=ArquivoIngestaoStatus.PROCESSANDO.value,
    )
    session.add(arquivo)
    session.flush()

    try:
        rows = parse_ingest_file(source)
        created = persist_transactions(session, uf.upper(), exercicio, arquivo.id, rows)
        for movimentacao in created:
            apply_deterministic_match(session, movimentacao.id)
        arquivo.status = ArquivoIngestaoStatus.CONCLUIDO.value
        session.flush()
        return created
    except Exception as exc:
        arquivo.status = ArquivoIngestaoStatus.ERRO.value
        arquivo.erro_mensagem = str(exc)
        session.flush()
        raise
