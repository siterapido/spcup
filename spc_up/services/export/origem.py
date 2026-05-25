"""Build Origem de Recursos XML from confirmed entrada movimentacoes."""

from __future__ import annotations

from pathlib import Path

from lxml import etree
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from spc_up.config import settings
from spc_up.models.entities import (
    ContaBancaria,
    Movimentacao,
    MovimentacaoDirecao,
    MovimentacaoSpca,
    MovimentacaoStatus,
    PessoaFisica,
    PessoaJuridica,
)
from spc_up.services.export.common import (
    build_cabecalho,
    format_moeda,
    make_origem_root,
    sub,
    write_xml,
)

_ESPECIE_TAG = {
    "PIX": "transferenciaEletronicaPIX",
    "TED": "transferenciaEletronicaTED",
    "TEL": "transferenciaEletronicaTEL",
    "TEB": "transferenciaEletronicaTEB",
    "CH": "depositoCheque",
    "EP": "depositoEspecie",
    "OB": "ordemBancaria",
    "CC": "cartaoCredito",
    "AC": "avisoCredito",
    "OT": "outrosTitulosCredito",
}


def _fetch_movimentacoes(session: Session, uf: str, exercicio: int) -> list[Movimentacao]:
    return list(
        session.execute(
            select(Movimentacao)
            .join(MovimentacaoSpca, MovimentacaoSpca.movimentacao_id == Movimentacao.id)
            .options(
                selectinload(Movimentacao.spca),
                selectinload(Movimentacao.pessoa_fisica),
                selectinload(Movimentacao.pessoa_juridica),
                selectinload(Movimentacao.conta_bancaria),
            )
            .where(
                Movimentacao.uf == uf,
                Movimentacao.exercicio == exercicio,
                Movimentacao.direcao == MovimentacaoDirecao.ENTRADA.value,
                Movimentacao.status == MovimentacaoStatus.CONFIRMADO.value,
            )
            .order_by(Movimentacao.data_movimento, Movimentacao.id)
        ).scalars().all()
    )


def _append_conta_destino(parent: etree._Element, conta: ContaBancaria | None) -> None:
    conta_destino = sub(parent, "contaBancariaDestino")
    banco = sub(conta_destino, "bancoDestino")
    if conta is None:
        sub(banco, "nrBancoDestino", "000")
        sub(banco, "agenciaDestino", "0000")
        sub(banco, "contaCorrente", "0")
        sub(banco, "dvContaCorrente", "0")
        return

    sub(banco, "nrBancoDestino", "000")
    sub(banco, "agenciaDestino", conta.agencia)
    sub(banco, "contaCorrente", conta.conta)
    sub(banco, "dvContaCorrente", conta.dv or "0")


def _append_especie_recurso(
    parent: etree._Element,
    spca: MovimentacaoSpca,
    movimentacao: Movimentacao,
) -> None:
    especie = (spca.especie_recurso or "PIX").upper()
    tag = _ESPECIE_TAG.get(especie, "transferenciaEletronicaPIX")
    especie_wrapper = sub(parent, "especieRecurso")
    especie_node = sub(especie_wrapper, tag)
    sub(especie_node, "especieRecurso", especie)

    if movimentacao.nr_extrato_bancario:
        sub(especie_node, "nrExtratoBancario", movimentacao.nr_extrato_bancario)

    if tag in {
        "transferenciaEletronicaPIX",
        "transferenciaEletronicaTED",
        "transferenciaEletronicaTEL",
        "transferenciaEletronicaTEB",
        "depositoCheque",
        "avisoCredito",
        "depositoEspecie",
        "ordemBancaria",
        "cartaoCredito",
    }:
        _append_conta_destino(especie_node, movimentacao.conta_bancaria)


def _append_origem_recurso(
    parent: etree._Element,
    spca: MovimentacaoSpca,
    movimentacao: Movimentacao,
) -> None:
    origem_recurso = sub(parent, "origemRecurso")
    tipo = (spca.tipo_origem_recurso or "PF").upper()

    if tipo == "PF":
        pessoa: PessoaFisica | None = movimentacao.pessoa_fisica
        if pessoa is None:
            raise ValueError(f"Movimentacao {movimentacao.id} requires pessoa_fisica for PF origem")
        pf = sub(origem_recurso, "pessoaFisica")
        sub(pf, "tipo", "PF")
        sub(pf, "nrCpf", pessoa.cpf)
        sub(pf, "nmPessoa", pessoa.nome)
        if pessoa.titulo_eleitor:
            sub(pf, "tituloEleitor", pessoa.titulo_eleitor)
        return

    if tipo == "PJ":
        pessoa = movimentacao.pessoa_juridica
        if pessoa is None:
            raise ValueError(f"Movimentacao {movimentacao.id} requires pessoa_juridica for PJ origem")
        pj = sub(origem_recurso, "pessoaJuridica")
        sub(pj, "tipo", "PJ")
        sub(pj, "nrCnpj", pessoa.cnpj)
        sub(pj, "nmPessoa", pessoa.razao_social)
        return

    raise ValueError(f"Unsupported tipo_origem_recurso: {tipo}")


def _append_origem_item(parent: etree._Element, movimentacao: Movimentacao) -> None:
    spca = movimentacao.spca
    if spca is None:
        raise ValueError(f"Movimentacao {movimentacao.id} missing spca payload")

    origem = sub(parent, "origem")
    sub(origem, "dtEntrada", movimentacao.data_movimento.isoformat())
    sub(origem, "vrOrigem", format_moeda(movimentacao.valor))
    sub(origem, "fonteRecurso", spca.fonte_recurso)
    sub(origem, "naturezaRecurso", spca.natureza_recurso)
    _append_origem_recurso(origem, spca, movimentacao)
    sub(origem, "classificacaoReceita", spca.classificacao_receita)

    if spca.descricao_resumida:
        sub(origem, "descricaoResumida", spca.descricao_resumida)
    if spca.nr_recibo_doacao:
        sub(origem, "nrReciboDoacao", spca.nr_recibo_doacao)

    _append_especie_recurso(origem, spca, movimentacao)


def build_origem_xml(session: Session, uf: str, exercicio: int, cnpj: str) -> Path:
    """Build and persist Origem de Recursos XML for confirmed entradas."""
    movimentacoes = _fetch_movimentacoes(session, uf, exercicio)

    root = make_origem_root()
    build_cabecalho(root, cnpj=cnpj, exercicio=exercicio)

    corpo = sub(root, "CORPO")
    origens = sub(corpo, "origens")
    sub(origens, "totalOrigem", len(movimentacoes))

    for movimentacao in movimentacoes:
        _append_origem_item(origens, movimentacao)

    output_path = (
        Path(settings.storage_root)
        / "exports"
        / uf
        / str(exercicio)
        / f"origem_{cnpj}.xml"
    )
    return write_xml(root, output_path)
