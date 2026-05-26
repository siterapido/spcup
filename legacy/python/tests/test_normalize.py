from spc_up.services.normalize import normalize_cnpj, normalize_cpf, normalize_name


def test_normalize_cpf_strips_mask():
    assert normalize_cpf("123.456.789-09") == "12345678909"


def test_normalize_cnpj_alphanumeric():
    assert len(normalize_cnpj("12.345.678/0001-90")) == 14


def test_normalize_name():
    assert normalize_name("  João   da  Silva ") == "JOAO DA SILVA"
