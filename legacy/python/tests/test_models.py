def test_movimentacao_status_enum():
    from spc_up.models.entities import MovimentacaoStatus

    assert MovimentacaoStatus.PENDENTE_REVISAO.value == "PENDENTE_REVISAO"
