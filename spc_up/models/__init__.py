"""SQLAlchemy models."""

from spc_up.models.base import Base, SessionLocal, engine, get_session
from spc_up.models.entities import (
    ArquivoIngestao,
    ArquivoIngestaoStatus,
    ContaBancaria,
    DiretorioEstadual,
    DoacaoFinanceiraLink,
    MatchEvidencia,
    Movimentacao,
    MovimentacaoDirecao,
    MovimentacaoSpca,
    MovimentacaoStatus,
    PessoaFisica,
    PessoaJuridica,
)

__all__ = [
    "ArquivoIngestao",
    "ArquivoIngestaoStatus",
    "Base",
    "ContaBancaria",
    "DiretorioEstadual",
    "DoacaoFinanceiraLink",
    "MatchEvidencia",
    "Movimentacao",
    "MovimentacaoDirecao",
    "MovimentacaoSpca",
    "MovimentacaoStatus",
    "PessoaFisica",
    "PessoaJuridica",
    "SessionLocal",
    "engine",
    "get_session",
]
