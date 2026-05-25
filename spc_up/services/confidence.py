"""Confidence scoring and export blocking for movimentacao matches."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

DEFAULT_WEIGHTS: dict[str, float] = {
    "CPF_EXATO": 0.45,
    "VALOR_DATA": 0.25,
    "NOME_ALTO": 0.20,
    "NOME_FUZZY": 0.10,
    "IA": 0.15,
}

DEFAULT_CONFLICT_CAP = 0.40

# Stub list — expand per direction/module when export builders land.
REQUIRED_SPCA_FIELDS: tuple[str, ...] = (
    "fonte_recurso",
    "natureza_recurso",
    "tipo_origem_recurso",
)


@dataclass(frozen=True, slots=True)
class Evidence:
    tipo: str
    peso: float | None = None
    cap: float | None = None


def _is_conflict(evidence: Evidence) -> bool:
    return evidence.tipo.startswith("CONFLITO")


def _evidence_weight(evidence: Evidence) -> float:
    if evidence.peso is not None:
        return evidence.peso
    return DEFAULT_WEIGHTS.get(evidence.tipo, 0.0)


def compute_confidence(evidences: Sequence[Evidence]) -> float:
    """Sum evidence weights and apply the tightest conflict cap when present."""
    score = 0.0
    conflict_cap: float | None = None

    for evidence in evidences:
        if _is_conflict(evidence):
            cap = evidence.cap if evidence.cap is not None else DEFAULT_CONFLICT_CAP
            conflict_cap = cap if conflict_cap is None else min(conflict_cap, cap)
            continue
        score += _evidence_weight(evidence)

    score = min(score, 1.0)
    if conflict_cap is not None:
        score = min(score, conflict_cap)
    return score


def _evidences_from_movimentacao(movimentacao: Any) -> list[Evidence]:
    return [
        Evidence(tipo=ev.tipo, peso=ev.peso)
        for ev in (getattr(movimentacao, "evidencias", None) or [])
    ]


def _missing_required_spca_fields(movimentacao: Any) -> bool:
    spca = getattr(movimentacao, "spca", None)
    if spca is None:
        return True

    for field in REQUIRED_SPCA_FIELDS:
        value = getattr(spca, field, None)
        if value is None or value == "":
            return True
    return False


def evaluate_movimentacao(
    movimentacao: Any,
    evidences: Sequence[Evidence] | None = None,
) -> float:
    """Update confianca_global and bloqueio_export on the movimentacao."""
    resolved = list(evidences) if evidences is not None else _evidences_from_movimentacao(movimentacao)
    score = compute_confidence(resolved)

    movimentacao.confianca_global = score
    movimentacao.bloqueio_export = _missing_required_spca_fields(movimentacao)
    return score
