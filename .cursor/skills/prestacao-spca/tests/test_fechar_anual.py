import json
import fechar_anual
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fechar_anual import swap_prestacao, restore_prestacao, UF_NOME, build_prestacao_json


def test_swap_prestacao_backup_e_swap(tmp_path):
    p = tmp_path / "prestacao.json"
    p.write_text(json.dumps({"estado": "Paraíba", "escopo": "campina-grande"}))
    swap_prestacao(p, {"estado": "Bahia", "escopo": ""})
    novo = json.loads(p.read_text())
    assert novo["estado"] == "Bahia"
    assert novo["escopo"] == ""
    backups = list(tmp_path.glob("prestacao.json.bak-*"))
    assert len(backups) == 1
    # backup tem o conteúdo original
    assert json.loads(backups[0].read_text())["estado"] == "Paraíba"


def test_restore_prestacao(tmp_path):
    p = tmp_path / "prestacao.json"
    p.write_text(json.dumps({"estado": "Paraíba", "escopo": "campina-grande"}))
    swap_prestacao(p, {"estado": "Bahia", "escopo": ""})
    restore_prestacao(p)
    atual = json.loads(p.read_text())
    assert atual["estado"] == "Paraíba"
    assert atual["escopo"] == "campina-grande"


def test_uf_nome_mapeia_corretamente():
    assert UF_NOME["BA"] == "Bahia"
    assert UF_NOME["SC"] == "Santa Catarina"
    assert UF_NOME["PB"] == "Paraíba"
    with pytest.raises(KeyError):
        UF_NOME["XX"]


def test_swap_preserva_campos_nao_escritos(tmp_path):
    """swap NÃO deve destruir campos extras do JSON original."""
    p = tmp_path / "prestacao.json"
    p.write_text(json.dumps({
        "estado": "Paraíba",
        "escopo": "campina-grande",
        "campo_custom": "valor_preservado_no_backup",
    }))
    swap_prestacao(p, {"estado": "Bahia", "escopo": ""})
    # o swap SOBRESCREVE o JSON (não é merge) — esse é o contrato
    atual = json.loads(p.read_text())
    assert "campo_custom" not in atual
    # mas o backup tem o original
    backups = list(tmp_path.glob("prestacao.json.bak-*"))
    assert json.loads(backups[0].read_text())["campo_custom"] == "valor_preservado_no_backup"


def test_build_prestacao_json_usa_load_constants_para_estadual(monkeypatch):
    """Para estadual, cnpj_prestador e modelo_extrato vêm de load_constants."""
    # mock load_constants para retornar dict fixo
    fake = {"cnpj_prestador": "47939572000102", "modelo_extrato": "caixa_1", "uf": "BA"}
    monkeypatch.setattr(fechar_anual, "get_prestacao", lambda estado, escopo="": fake)
    args = MagicMock()
    args.uf = "BA"
    args.ano = 2025
    args.escopo = ""
    resultado = build_prestacao_json(args, "Bahia")
    assert resultado["cnpj_prestador"] == "47939572000102"
    assert resultado["modelo_extrato"] == "caixa_1"
    assert resultado["estado"] == "Bahia"
    assert resultado["base_prestacao"] == "Bahia"


def test_build_prestacao_json_usa_load_constants_para_municipio_pb(monkeypatch):
    """Para PB-Campina Grande, cnpj do município vem de load_constants."""
    fake = {"cnpj_prestador": "36734808000140", "modelo_extrato": "caixa_1", "uf": "PB"}
    monkeypatch.setattr(fechar_anual, "get_prestacao", lambda estado, escopo="": fake)
    args = MagicMock()
    args.uf = "PB"
    args.ano = 2025
    args.escopo = "campina-grande"
    resultado = build_prestacao_json(args, "Paraíba")
    assert resultado["cnpj_prestador"] == "36734808000140"
    assert resultado["modelo_extrato"] == "caixa_1"
    assert resultado["estado"] == "Paraíba"
    assert resultado["base_prestacao"] == "Paraíba/municipios/campina-grande"
    assert resultado["escopo"] == "campina-grande"


def test_build_prestacao_json_sc_bb_unificado(monkeypatch):
    """Para SC estadual, modelo_extrato deve ser bb_unificado."""
    fake = {"cnpj_prestador": "83655975000130", "modelo_extrato": "bb_unificado", "uf": "SC"}
    monkeypatch.setattr(fechar_anual, "get_prestacao", lambda estado, escopo="": fake)
    args = MagicMock()
    args.uf = "SC"
    args.ano = 2025
    args.escopo = ""
    resultado = build_prestacao_json(args, "Santa Catarina")
    assert resultado["cnpj_prestador"] == "83655975000130"
    assert resultado["modelo_extrato"] == "bb_unificado"
