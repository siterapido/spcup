"""Tests for Excel ingestion."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from openpyxl import Workbook

from spc_up.services.ingest.excel import parse_excel

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "sample.xlsx"


def _write_sample_xlsx(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Extrato"
    sheet.append(["data", "valor", "descricao", "tipo"])
    sheet.append([date(2025, 1, 10), 1500.50, "Recebimento doacao", "C"])
    sheet.append([date(2025, 1, 11), -320.00, "Pagamento fornecedor", "D"])
    sheet.append([date(2025, 1, 12), 80.00, "Tarifa sem tipo", None])
    workbook.save(path)
    workbook.close()


@pytest.fixture(scope="module", autouse=True)
def sample_xlsx_fixture() -> None:
    _write_sample_xlsx(FIXTURE_PATH)


def test_parse_excel_directions():
    rows = parse_excel(FIXTURE_PATH)
    assert any(r["direcao"] == "ENTRADA" for r in rows)
    assert any(r["direcao"] == "SAIDA" for r in rows)


def test_parse_excel_returns_expected_fields():
    rows = parse_excel(FIXTURE_PATH)
    assert len(rows) == 3
    for row in rows:
        assert set(row.keys()) >= {
            "data_movimento",
            "valor",
            "descricao_raw",
            "direcao",
            "nr_extrato_bancario",
        }
        assert isinstance(row["valor"], Decimal)
        assert row["direcao"] in {"ENTRADA", "SAIDA"}
        assert row["nr_extrato_bancario"] is None


def test_parse_excel_tipo_and_sign_inference():
    rows = parse_excel(FIXTURE_PATH)
    by_desc = {row["descricao_raw"]: row for row in rows}

    entrada = by_desc["Recebimento doacao"]
    assert entrada["direcao"] == "ENTRADA"
    assert entrada["valor"] == Decimal("1500.50")

    saida = by_desc["Pagamento fornecedor"]
    assert saida["direcao"] == "SAIDA"
    assert saida["valor"] == Decimal("320.00")

    inferred = by_desc["Tarifa sem tipo"]
    assert inferred["direcao"] == "ENTRADA"
    assert inferred["valor"] == Decimal("80.00")


def test_parse_excel_missing_required_columns(tmp_path: Path):
    path = tmp_path / "bad.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["data", "valor"])
    sheet.append([date(2025, 1, 1), 10])
    workbook.save(path)
    workbook.close()

    with pytest.raises(ValueError, match="descricao"):
        parse_excel(path)
