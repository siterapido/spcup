from spc_up.spca.load_tables import get_classificacao_label, get_gasto_label


def test_load_classificacao():
    assert "314" in get_classificacao_label("314")
    assert "DOAÇÕES" in get_classificacao_label(314)


def test_load_gasto():
    assert "410" in get_gasto_label("410")
    assert "CARTÕES" in get_gasto_label(410)


def test_unknown_code_returns_code_only():
    assert get_classificacao_label("999") == "999"
    assert get_gasto_label("999") == "999"
