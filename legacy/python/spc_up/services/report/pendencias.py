"""Pendencias CSV report for UF/exercicio (spec section 7.3)."""

from __future__ import annotations

import csv
from pathlib import Path

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from spc_up.models.entities import Movimentacao, MovimentacaoStatus
from spc_up.services.confidence import REQUIRED_SPCA_FIELDS

_EXPORTABLE_STATUSES = (
    MovimentacaoStatus.CONFIRMADO.value,
    MovimentacaoStatus.EXPORTADO.value,
)

CSV_COLUMNS = (
    "data",
    "valor",
    "descricao",
    "motivo",
    "campos_xsd_faltantes",
    "arquivo_origem",
)


def _missing_spca_fields(movimentacao: Movimentacao) -> list[str]:
    spca = movimentacao.spca
    if spca is None:
        return list(REQUIRED_SPCA_FIELDS)

    return [
        field
        for field in REQUIRED_SPCA_FIELDS
        if not getattr(spca, field, None)
    ]


def _pendencia_motivo(movimentacao: Movimentacao, missing_fields: list[str]) -> str:
    reasons: list[str] = []
    if movimentacao.status not in _EXPORTABLE_STATUSES:
        reasons.append(f"status={movimentacao.status}")
    if movimentacao.bloqueio_export and missing_fields:
        reasons.append("campos_xsd_obrigatorios_faltantes")
    elif movimentacao.bloqueio_export:
        reasons.append("bloqueio_export")
    if movimentacao.confianca_global < 0.60:
        reasons.append("confianca_baixa")
    return "; ".join(reasons) if reasons else "pendencia"


def generate_pendencias_csv(
    session: Session,
    uf: str,
    exercicio: int,
    output_path: str | Path,
) -> int:
    """Write pendencias CSV and return the number of rows written."""
    movimentacoes = session.execute(
        select(Movimentacao)
        .options(
            selectinload(Movimentacao.spca),
            selectinload(Movimentacao.arquivo_ingestao),
        )
        .where(
            Movimentacao.uf == uf,
            Movimentacao.exercicio == exercicio,
            or_(
                Movimentacao.status.not_in(_EXPORTABLE_STATUSES),
                Movimentacao.bloqueio_export.is_(True),
            ),
        )
        .order_by(Movimentacao.data_movimento, Movimentacao.id)
    ).scalars().all()

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for movimentacao in movimentacoes:
            missing = _missing_spca_fields(movimentacao)
            arquivo_origem = ""
            if movimentacao.arquivo_ingestao is not None:
                arquivo_origem = movimentacao.arquivo_ingestao.nome_arquivo

            writer.writerow(
                {
                    "data": movimentacao.data_movimento.isoformat(),
                    "valor": f"{movimentacao.valor:.2f}",
                    "descricao": movimentacao.descricao_raw,
                    "motivo": _pendencia_motivo(movimentacao, missing),
                    "campos_xsd_faltantes": ",".join(missing),
                    "arquivo_origem": arquivo_origem,
                }
            )

    return len(movimentacoes)
