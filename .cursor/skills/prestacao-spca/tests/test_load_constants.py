from load_constants import get_prestacao, get_xml_defaults


def test_campina_grande_retorna_cnpj_correto():
    p = get_prestacao("Paraíba", "campina-grande")
    assert p["cnpj_prestador"] == "36734808000140"
    assert p["modelo_extrato"] == "caixa_1"


def test_sc_retorna_bb_unificado():
    p = get_prestacao("Santa Catarina")
    assert p["modelo_extrato"] == "bb_unificado"
    assert p["uf"] == "SC"


def test_ba_retorna_caixa():
    p = get_prestacao("Bahia")
    assert p["modelo_extrato"] == "caixa_1"
    assert p["cnpj_prestador"] == "47939572000102"


def test_pb_estadual_sem_escopo():
    p = get_prestacao("Paraíba")
    assert p["cnpj_prestador"] == "36667299000180"


def test_xml_defaults_caixa():
    d = get_xml_defaults("caixa_1")
    assert d["banco"] == "104"
    assert d["classificacao"] == "320"


def test_xml_defaults_bb():
    d = get_xml_defaults("bb_unificado")
    assert d["banco"] == "001"
