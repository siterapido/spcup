"""Build Aplicacao de Recursos XML from confirmed saida movimentacoes."""

from __future__ import annotations

from pathlib import Path

from lxml import etree
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from spc_up.config import settings
from spc_up.models.entities import (
    Movimentacao,
    MovimentacaoDirecao,
    MovimentacaoSpca,
    MovimentacaoStatus,
    PessoaFisica,
    PessoaJuridica,
)
from spc_up.services.export.common import format_moeda, write_xml

APLICACAO_NS = "http://www.tse.jus.br/2012/XMLSchema/aplicacaoRecurso.xsd"
APLICACAO_NSMAP = {None: APLICACAO_NS}

_DEFAULT_CD_GASTO = "401"
_DEFAULT_DETALHE_SITUACAO = 1


def _sub(parent: etree._Element, tag: str, text: str | int | None = None) -> etree._Element:
    element = etree.SubElement(parent, f"{{{APLICACAO_NS}}}{tag}")
    if text is not None:
        element.text = str(text)
    return element


def make_aplicacao_root() -> etree._Element:
    return etree.Element(f"{{{APLICACAO_NS}}}importacaoAplicacaoRecurso", nsmap=APLICACAO_NSMAP)


def _build_cabecalho(parent: etree._Element, *, cnpj: str, exercicio: int) -> None:
    cabecalho = _sub(parent, "CABECALHO")
    _sub(cabecalho, "nrCnpjPrestador", cnpj)
    _sub(cabecalho, "anoExercicio", exercicio)


def _fetch_movimentacoes(session: Session, uf: str, exercicio: int) -> list[Movimentacao]:
    return list(
        session.execute(
            select(Movimentacao)
            .join(MovimentacaoSpca, MovimentacaoSpca.movimentacao_id == Movimentacao.id)
            .options(
                selectinload(Movimentacao.spca),
                selectinload(Movimentacao.pessoa_fisica),
                selectinload(Movimentacao.pessoa_juridica),
            )
            .where(
                Movimentacao.uf == uf,
                Movimentacao.exercicio == exercicio,
                Movimentacao.direcao == MovimentacaoDirecao.SAIDA.value,
                Movimentacao.status == MovimentacaoStatus.CONFIRMADO.value,
            )
            .order_by(Movimentacao.data_movimento, Movimentacao.id)
        ).scalars().all()
    )


def _append_pessoa(parent: etree._Element, movimentacao: Movimentacao, spca: MovimentacaoSpca) -> None:
    pessoa = _sub(parent, "pessoa")
    tipo = (spca.tipo_origem_recurso or "").upper()

    if movimentacao.pessoa_juridica is not None or tipo == "PJ":
        pj: PessoaJuridica | None = movimentacao.pessoa_juridica
        if pj is None:
            raise ValueError(f"Movimentacao {movimentacao.id} requires pessoa_juridica for PJ gasto")
        pj_node = _sub(pessoa, "pessoaJuridica")
        _sub(pj_node, "nrCnpj", pj.cnpj)
        _sub(pj_node, "nmPessoa", pj.razao_social)
        return

    if movimentacao.pessoa_fisica is not None or tipo == "PF":
        pf: PessoaFisica | None = movimentacao.pessoa_fisica
        if pf is None:
            raise ValueError(f"Movimentacao {movimentacao.id} requires pessoa_fisica for PF gasto")
        pf_node = _sub(pessoa, "pessoaFisica")
        _sub(pf_node, "nrCpf", pf.cpf)
        _sub(pf_node, "nmPessoa", pf.nome)
        return

    raise ValueError(f"Movimentacao {movimentacao.id} requires pessoa_fisica or pessoa_juridica")


def _append_dados_documento(
    parent: etree._Element,
    movimentacao: Movimentacao,
    spca: MovimentacaoSpca,
) -> None:
    dados_documento = _sub(parent, "dadosDocumento")
    recibo = _sub(dados_documento, "recibo")

    if spca.nr_documento:
        _sub(recibo, "nrDocumento", spca.nr_documento)

    data_emissao = spca.data_emissao_contratacao or movimentacao.data_movimento
    _sub(recibo, "dataEmissaoContratacao", data_emissao.isoformat())
    _sub(recibo, "vrTotalDocumento", format_moeda(movimentacao.valor))


def _append_detalhe_situacao(
    parent: etree._Element,
    *,
    detalhe_situacao: int,
    descricao_resumida: str,
) -> None:
    if detalhe_situacao != _DEFAULT_DETALHE_SITUACAO:
        raise ValueError(f"Unsupported detalhe_situacao: {detalhe_situacao}")

    situacao = _sub(parent, "situacao1")
    if descricao_resumida:
        _sub(situacao, "descricaoResumida", descricao_resumida)


def _append_gasto_conta_contabil(
    parent: etree._Element,
    movimentacao: Movimentacao,
    spca: MovimentacaoSpca,
) -> None:
    classificacao = _sub(parent, "classificacaoGasto")
    conta = _sub(classificacao, "gastoContaContabil")
    cd_gasto = spca.cd_descricao_gasto or _DEFAULT_CD_GASTO
    _sub(conta, "cdDescricaoGasto", cd_gasto)
    _sub(conta, "vrGasto", format_moeda(movimentacao.valor))

    detalhe = spca.detalhe_situacao or _DEFAULT_DETALHE_SITUACAO
    descricao = spca.descricao_resumida or movimentacao.descricao_raw
    _append_detalhe_situacao(conta, detalhe_situacao=detalhe, descricao_resumida=descricao)


def _append_gasto(parent: etree._Element, movimentacao: Movimentacao) -> None:
    spca = movimentacao.spca
    if spca is None:
        raise ValueError(f"Movimentacao {movimentacao.id} missing spca payload")

    gasto = _sub(parent, "gasto")
    _append_pessoa(gasto, movimentacao, spca)
    _append_dados_documento(gasto, movimentacao, spca)
    _append_gasto_conta_contabil(gasto, movimentacao, spca)


def build_aplicacao_xml(session: Session, uf: str, exercicio: int, cnpj: str) -> Path:
    """Build and persist Aplicacao de Recursos XML for confirmed saidas."""
    movimentacoes = _fetch_movimentacoes(session, uf, exercicio)

    root = make_aplicacao_root()
    _build_cabecalho(root, cnpj=cnpj, exercicio=exercicio)

    corpo = _sub(root, "CORPO")
    for movimentacao in movimentacoes:
        _append_gasto(corpo, movimentacao)

    output_path = (
        Path(settings.storage_root)
        / "exports"
        / uf
        / str(exercicio)
        / f"aplicacao_{cnpj}.xml"
    )
    return write_xml(root, output_path)
