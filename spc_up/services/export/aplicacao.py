"""Build Aplicação de Recursos XML from confirmed saída movimentacoes."""

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
from spc_up.services.export.common import (
    APLICACAO_NS,
    build_cabecalho,
    format_moeda,
    make_aplicacao_root,
    sub_aplicacao,
    write_xml,
)

_DOCUMENTO_TAG = {
    "BOLETO": "boleto",
    "CONTRATO": "contrato",
    "FISCAL": "fiscal",
    "FATURA": "fatura",
    "RECIBO": "recibo",
    "OUTRO": "outro",
}

_DEFAULT_CD_GASTO = "401"
_DEFAULT_DETALHE_SITUACAO = 1
_DEFAULT_TIPO_DOCUMENTO = "RECIBO"


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


def _append_pessoa(parent: etree._Element, movimentacao: Movimentacao) -> None:
    pessoa_wrapper = sub_aplicacao(parent, "pessoa")

    if movimentacao.pessoa_juridica is not None:
        pj: PessoaJuridica = movimentacao.pessoa_juridica
        pj_node = sub_aplicacao(pessoa_wrapper, "pessoaJuridica")
        sub_aplicacao(pj_node, "nrCnpj", pj.cnpj)
        sub_aplicacao(pj_node, "nmPessoa", pj.razao_social)
        return

    if movimentacao.pessoa_fisica is not None:
        pf: PessoaFisica = movimentacao.pessoa_fisica
        pf_node = sub_aplicacao(pessoa_wrapper, "pessoaFisica")
        sub_aplicacao(pf_node, "nrCpf", pf.cpf)
        sub_aplicacao(pf_node, "nmPessoa", pf.nome)
        return

    raise ValueError(
        f"Movimentacao {movimentacao.id} requires pessoa_fisica or pessoa_juridica for aplicacao"
    )


def _append_dados_documento(
    parent: etree._Element,
    spca: MovimentacaoSpca,
    movimentacao: Movimentacao,
) -> None:
    tipo = (spca.tipo_documento or _DEFAULT_TIPO_DOCUMENTO).upper()
    tag = _DOCUMENTO_TAG.get(tipo, "recibo")

    dados = sub_aplicacao(parent, "dadosDocumento")
    doc = sub_aplicacao(dados, tag)

    if tag == "outro":
        descricao = spca.descricao_resumida or movimentacao.descricao_raw
        sub_aplicacao(doc, "descricao", descricao[:20])

    if spca.nr_documento:
        sub_aplicacao(doc, "nrDocumento", spca.nr_documento)

    data_emissao = spca.data_emissao_contratacao or movimentacao.data_movimento
    sub_aplicacao(doc, "dataEmissaoContratacao", data_emissao.isoformat())
    sub_aplicacao(doc, "vrTotalDocumento", format_moeda(movimentacao.valor))


def _append_detalhe_situacao(
    gasto_conta: etree._Element,
    spca: MovimentacaoSpca,
    movimentacao: Movimentacao,
) -> None:
    situacao = spca.detalhe_situacao if spca.detalhe_situacao is not None else _DEFAULT_DETALHE_SITUACAO
    if situacao != 1:
        return

    descricao = spca.descricao_resumida or movimentacao.descricao_raw
    situacao_node = sub_aplicacao(gasto_conta, "situacao1")
    sub_aplicacao(situacao_node, "descricaoResumida", descricao)


def _append_classificacao_gasto(
    parent: etree._Element,
    spca: MovimentacaoSpca,
    movimentacao: Movimentacao,
) -> None:
    classificacao = sub_aplicacao(parent, "classificacaoGasto")
    gasto_conta = sub_aplicacao(classificacao, "gastoContaContabil")
    cd_gasto = spca.cd_descricao_gasto or _DEFAULT_CD_GASTO
    sub_aplicacao(gasto_conta, "cdDescricaoGasto", cd_gasto)
    sub_aplicacao(gasto_conta, "vrGasto", format_moeda(movimentacao.valor))
    _append_detalhe_situacao(gasto_conta, spca, movimentacao)


def _append_gasto(parent: etree._Element, movimentacao: Movimentacao) -> None:
    spca = movimentacao.spca
    if spca is None:
        raise ValueError(f"Movimentacao {movimentacao.id} missing spca payload")

    gasto = sub_aplicacao(parent, "gasto")
    _append_pessoa(gasto, movimentacao)
    _append_dados_documento(gasto, spca, movimentacao)
    _append_classificacao_gasto(gasto, spca, movimentacao)


def build_aplicacao_xml(session: Session, uf: str, exercicio: int, cnpj: str) -> Path:
    """Build and persist Aplicação de Recursos XML for confirmed saídas."""
    movimentacoes = _fetch_movimentacoes(session, uf, exercicio)

    root = make_aplicacao_root()
    build_cabecalho(root, cnpj=cnpj, exercicio=exercicio, namespace=APLICACAO_NS)

    corpo = sub_aplicacao(root, "CORPO")
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
