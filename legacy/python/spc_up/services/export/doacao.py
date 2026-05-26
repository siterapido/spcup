"""Build Doacao Financeira XML from synchronized doacao links."""

from __future__ import annotations

from pathlib import Path

from lxml import etree
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from spc_up.config import settings
from spc_up.models.entities import (
    ContaBancaria,
    DoacaoFinanceiraLink,
    Movimentacao,
    MovimentacaoDirecao,
    MovimentacaoSpca,
    MovimentacaoStatus,
    PessoaFisica,
)
from spc_up.services.export.common import format_moeda, write_xml

DOACAO_NS = "http://www.tse.jus.br/2012/XMLSchema/doacaoFinanceiraPartidoCandidato.xsd"
DOACAO_NSMAP = {None: DOACAO_NS}

_DEFAULT_NUM_PARTIDO = 13
_FORMA_DOACAO = {"PIX": "PIX", "TED": "TED", "TEL": "TEL", "TEB": "TEB", "CH": "CH"}
_OPERACAO_FINANCEIRA = {"PIX": "PIX", "TED": "TED", "TEL": "TEL", "EP": "EP"}


def _sub(parent: etree._Element, tag: str, text: str | int | None = None) -> etree._Element:
    element = etree.SubElement(parent, f"{{{DOACAO_NS}}}{tag}")
    if text is not None:
        element.text = str(text)
    return element


def make_doacao_root() -> etree._Element:
    return etree.Element(f"{{{DOACAO_NS}}}spcaImportacaoArquivo", nsmap=DOACAO_NSMAP)


def _build_cabecalho(parent: etree._Element, *, cnpj: str, exercicio: int) -> None:
    cabecalho = _sub(parent, "CABECALHO")
    _sub(cabecalho, "nrCnpjPrestador", cnpj)
    _sub(cabecalho, "anoExercicio", exercicio)


def _fetch_movimentacoes(session: Session, uf: str, exercicio: int) -> list[Movimentacao]:
    return list(
        session.execute(
            select(Movimentacao)
            .join(DoacaoFinanceiraLink, DoacaoFinanceiraLink.movimentacao_origem_id == Movimentacao.id)
            .join(MovimentacaoSpca, MovimentacaoSpca.movimentacao_id == Movimentacao.id)
            .options(
                selectinload(Movimentacao.spca),
                selectinload(Movimentacao.pessoa_fisica),
                selectinload(Movimentacao.conta_bancaria),
                selectinload(Movimentacao.doacao_link),
            )
            .where(
                Movimentacao.uf == uf,
                Movimentacao.exercicio == exercicio,
                Movimentacao.direcao == MovimentacaoDirecao.ENTRADA.value,
                Movimentacao.status == MovimentacaoStatus.CONFIRMADO.value,
                DoacaoFinanceiraLink.sincronizado.is_(True),
            )
            .order_by(Movimentacao.data_movimento, Movimentacao.id)
        ).scalars().all()
    )


def _append_conta_destino(parent: etree._Element, conta: ContaBancaria | None) -> None:
    conta_destino = _sub(parent, "contaBancariaDestino")
    banco = _sub(conta_destino, "bancoDestino")
    if conta is None:
        _sub(banco, "nrBancoOrigem", "000")
        _sub(banco, "agenciaOrigem", "0000")
        _sub(banco, "contaCorrente", "0")
        _sub(banco, "dvContaCorrente", "0")
        return

    _sub(banco, "nrBancoOrigem", "000")
    _sub(banco, "agenciaOrigem", conta.agencia)
    _sub(banco, "contaCorrente", conta.conta)
    _sub(banco, "dvContaCorrente", conta.dv or "0")


def _append_beneficiario(parent: etree._Element, *, cnpj: str, uf: str, exercicio: int) -> None:
    beneficiario = _sub(parent, "beneficiario")
    partido = _sub(beneficiario, "partido")
    _sub(partido, "tipo", "PP")
    _sub(partido, "nrCnpj", cnpj)
    _sub(partido, "esferaPartidaria", "ESTADUAL")
    _sub(partido, "eleicao", exercicio)
    _sub(partido, "eleicaoSuplementar", "N")
    _sub(partido, "partido", _DEFAULT_NUM_PARTIDO)
    _sub(partido, "uf", uf)


def _append_doador(parent: etree._Element, movimentacao: Movimentacao, spca: MovimentacaoSpca) -> None:
    pessoa: PessoaFisica | None = movimentacao.pessoa_fisica
    if pessoa is None:
        raise ValueError(f"Movimentacao {movimentacao.id} requires pessoa_fisica for doacao export")

    recibo = spca.nr_recibo_doacao
    if not recibo:
        raise ValueError(f"Movimentacao {movimentacao.id} missing nr_recibo_doacao")

    doadores = _sub(parent, "doadoresOriginarios")
    dador = _sub(doadores, "dadorOriginario")
    pf = _sub(dador, "pessoaFisica")
    _sub(pf, "nrCpf", pessoa.cpf)
    _sub(pf, "nmPessoa", pessoa.nome)
    if pessoa.titulo_eleitor:
        _sub(pf, "tituloEleitor", pessoa.titulo_eleitor)
    _sub(pf, "nrReciboDoacao", recibo)
    _sub(pf, "vrDoacao", format_moeda(movimentacao.valor))


def _append_doacao_item(
    parent: etree._Element,
    movimentacao: Movimentacao,
    *,
    cnpj: str,
    uf: str,
    exercicio: int,
) -> None:
    spca = movimentacao.spca
    if spca is None:
        raise ValueError(f"Movimentacao {movimentacao.id} missing spca payload")

    doacao = _sub(parent, "doacao")
    _append_beneficiario(doacao, cnpj=cnpj, uf=uf, exercicio=exercicio)
    _sub(doacao, "dtDoacao", movimentacao.data_movimento.isoformat())
    _sub(doacao, "fonteRecurso", spca.fonte_recurso or "OR")

    classificacao = _sub(doacao, "classificacoesDoacao")
    _sub(classificacao, "valorDoacao", format_moeda(movimentacao.valor))

    especie = (spca.especie_recurso or "PIX").upper()
    forma = _FORMA_DOACAO.get(especie, "PIX")
    _sub(doacao, "formaDoacao", forma)
    operacao = _OPERACAO_FINANCEIRA.get(especie)
    if operacao:
        _sub(doacao, "operacaoFinanceira", operacao)

    nr_extrato = movimentacao.nr_extrato_bancario or spca.nr_recibo_doacao or "0"
    _sub(doacao, "nrExtratoBancario", nr_extrato)
    _sub(doacao, "contaBancariaOrigem")
    _sub(doacao, "nrDocumento", nr_extrato)
    _sub(doacao, "nrReciboDoacao", spca.nr_recibo_doacao)
    _append_doador(doacao, movimentacao, spca)
    _append_conta_destino(doacao, movimentacao.conta_bancaria)


def build_doacao_xml(session: Session, uf: str, exercicio: int, cnpj: str) -> Path:
    """Build and persist Doacao Financeira XML for synchronized doacao links."""
    movimentacoes = _fetch_movimentacoes(session, uf, exercicio)

    root = make_doacao_root()
    _build_cabecalho(root, cnpj=cnpj, exercicio=exercicio)

    corpo = _sub(root, "CORPO")
    doacoes = _sub(corpo, "doacoes")
    _sub(doacoes, "totalDoacao", len(movimentacoes))

    for movimentacao in movimentacoes:
        _append_doacao_item(doacoes, movimentacao, cnpj=cnpj, uf=uf, exercicio=exercicio)

    output_path = (
        Path(settings.storage_root)
        / "exports"
        / uf
        / str(exercicio)
        / f"doacao_{cnpj}.xml"
    )
    return write_xml(root, output_path)
