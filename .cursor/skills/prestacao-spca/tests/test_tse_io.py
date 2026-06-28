from pathlib import Path

import pytest

# scripts/ adicionado via conftest.py

from tse_io import ler_csv_tse, escrever_xml_tse


def test_ler_csv_tse_decodifica_iso_8859_1(tmp_path):
    p = tmp_path / "test.csv"
    # CSV do TSE sempre tem 4 linhas de metadata antes do header.
    p.write_bytes(
        "meta0\nmeta1\nmeta2\nmeta3\n".encode("iso-8859-1")
        + "Gera\xe7\xe3o;Exerc\xedcio\nOK;2025\n".encode("iso-8859-1")
    )
    rows = list(ler_csv_tse(p))
    assert rows[0] == ["Geração", "Exercício"]
    assert rows[1] == ["OK", "2025"]


def test_ler_csv_tse_pula_4_linhas_metadata(tmp_path):
    p = tmp_path / "test.csv"
    p.write_bytes(
        "linha0_meta\nlinha1_meta\nlinha2_meta\nlinha3_meta\n".encode("iso-8859-1")
        + "header1;header2\nvalor1;valor2\n".encode("iso-8859-1")
    )
    rows = list(ler_csv_tse(p))
    # deve pular as 4 linhas de metadata e ler só header + dados
    assert rows[0] == ["header1", "header2"]
    assert rows[1] == ["valor1", "valor2"]


def test_escrever_xml_tse_preserva_iso_8859_1(tmp_path):
    p = tmp_path / "out.xml"
    escrever_xml_tse(p, '<?xml version="1.0" encoding="ISO-8859-1"?>\n<raiz>Geração</raiz>')
    raw = p.read_bytes()
    assert b"Gera\xe7\xe3o" in raw
    assert b"ISO-8859-1" in raw


def test_db_path_aponta_para_projeto_canonico():
    from tse_io import DB_PATH, PROJECT_RAIZ
    assert DB_PATH == PROJECT_RAIZ / "resultados" / "spca_revisao.db"
    assert DB_PATH.name == "spca_revisao.db"
