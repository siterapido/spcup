"""Deterministic transaction matching rules (CPF/CNPJ extraction)."""

from __future__ import annotations

import re
import uuid
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from spc_up.config import settings
from spc_up.models.entities import (
    MatchEvidencia,
    Movimentacao,
    MovimentacaoStatus,
    PessoaFisica,
    PessoaJuridica,
)
from spc_up.services.confidence import DEFAULT_WEIGHTS, evaluate_movimentacao
from spc_up.services.normalize import normalize_cnpj, normalize_cpf

_CPF_PATTERN = re.compile(
    r"\b(?:\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})\b",
)
_CNPJ_PATTERN = re.compile(
    r"\b(?:\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}|"
    r"[A-Za-z0-9]{2}\.?[A-Za-z0-9]{3}\.?[A-Za-z0-9]{3}/?[A-Za-z0-9]{4}-?\d{2})\b",
)

STUB_PF_NOME = "DESCONHECIDO"
STUB_PJ_RAZAO = "DESCONHECIDA"


def _extract_document_candidates(descricao: str) -> list[tuple[Literal["CPF", "CNPJ"], str]]:
    seen: set[str] = set()
    candidates: list[tuple[Literal["CPF", "CNPJ"], str]] = []

    for match in _CNPJ_PATTERN.finditer(descricao):
        raw = match.group(0)
        try:
            normalized = normalize_cnpj(raw)
        except ValueError:
            continue
        if normalized not in seen:
            seen.add(normalized)
            candidates.append(("CNPJ", normalized))

    for match in _CPF_PATTERN.finditer(descricao):
        raw = match.group(0)
        try:
            normalized = normalize_cpf(raw)
        except ValueError:
            continue
        if normalized not in seen:
            seen.add(normalized)
            candidates.append(("CPF", normalized))

    return candidates


def _get_or_create_pessoa_fisica(session: Session, cpf: str) -> PessoaFisica:
    pessoa = session.scalar(select(PessoaFisica).where(PessoaFisica.cpf == cpf))
    if pessoa is not None:
        return pessoa

    pessoa = PessoaFisica(cpf=cpf, nome=STUB_PF_NOME)
    session.add(pessoa)
    session.flush()
    return pessoa


def _get_or_create_pessoa_juridica(session: Session, cnpj: str) -> PessoaJuridica:
    pessoa = session.scalar(select(PessoaJuridica).where(PessoaJuridica.cnpj == cnpj))
    if pessoa is not None:
        return pessoa

    pessoa = PessoaJuridica(cnpj=cnpj, razao_social=STUB_PJ_RAZAO)
    session.add(pessoa)
    session.flush()
    return pessoa


def _resolve_status(movimentacao: Movimentacao, score: float) -> MovimentacaoStatus:
    if score < settings.confianca_limiar_alta:
        return MovimentacaoStatus.PENDENTE_REVISAO

    pessoa_linked = movimentacao.pessoa_fisica_id is not None or movimentacao.pessoa_juridica_id is not None
    if pessoa_linked and not movimentacao.bloqueio_export:
        return MovimentacaoStatus.CONFIRMADO

    return MovimentacaoStatus.PENDENTE_REVISAO


def apply_deterministic_match(session: Session, movimentacao_id: uuid.UUID) -> Movimentacao:
    """Extract CPF/CNPJ from description, link pessoa, score and update status."""
    movimentacao = session.get(Movimentacao, movimentacao_id)
    if movimentacao is None:
        raise ValueError(f"Movimentacao {movimentacao_id} not found")

    movimentacao.evidencias.clear()

    cpfs: list[str] = []
    cnpjs: list[str] = []
    for doc_type, normalized in _extract_document_candidates(movimentacao.descricao_raw):
        if doc_type == "CPF":
            cpfs.append(normalized)
        else:
            cnpjs.append(normalized)

    if len(cpfs) > 1 or len(cnpjs) > 1 or (cpfs and cnpjs):
        movimentacao.evidencias.append(
            MatchEvidencia(
                tipo="CONFLITO_DOCUMENTO",
                peso=0.0,
                detalhe="Multiplos documentos encontrados na descricao",
            )
        )
        score = evaluate_movimentacao(movimentacao)
        movimentacao.status = _resolve_status(movimentacao, score)
        session.commit()
        session.refresh(movimentacao)
        return movimentacao

    if cpfs:
        cpf = cpfs[0]
        pessoa = _get_or_create_pessoa_fisica(session, cpf)
        movimentacao.pessoa_fisica_id = pessoa.id
        movimentacao.pessoa_juridica_id = None
        peso = DEFAULT_WEIGHTS["CPF_EXATO"]
        movimentacao.evidencias.append(
            MatchEvidencia(
                tipo="CPF_EXATO",
                peso=peso,
                detalhe=f"CPF {cpf} extraido da descricao",
            )
        )
    elif cnpjs:
        cnpj = cnpjs[0]
        pessoa = _get_or_create_pessoa_juridica(session, cnpj)
        movimentacao.pessoa_juridica_id = pessoa.id
        movimentacao.pessoa_fisica_id = None
        peso = DEFAULT_WEIGHTS["CPF_EXATO"]
        movimentacao.evidencias.append(
            MatchEvidencia(
                tipo="CNPJ_EXATO",
                peso=peso,
                detalhe=f"CNPJ {cnpj} extraido da descricao",
            )
        )

    score = evaluate_movimentacao(movimentacao)
    movimentacao.status = _resolve_status(movimentacao, score)
    session.commit()
    session.refresh(movimentacao)
    return movimentacao
