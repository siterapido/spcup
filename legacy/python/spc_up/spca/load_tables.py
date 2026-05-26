"""Load SPCA domain tables from YAML files."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

TABELAS_DIR = Path(__file__).parent / "tabelas"


def _normalize_code(code: str | int) -> str:
    return str(code).strip()


def _lookup_entry(table: dict[Any, Any], code: str | int) -> dict[str, Any] | None:
    key = _normalize_code(code)
    entry = table.get(key)
    if entry is not None:
        return entry
    if key.isdigit():
        return table.get(int(key))
    return None


@lru_cache
def _load_table(filename: str) -> dict[Any, Any]:
    path = TABELAS_DIR / filename
    with path.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"Expected mapping in {filename}")
    return data


def _format_label(code: str | int, filename: str) -> str:
    key = _normalize_code(code)
    entry = _lookup_entry(_load_table(filename), code)
    if entry is None:
        return key
    descricao = entry.get("descricao", "")
    if descricao:
        return f"{key} - {descricao}"
    return key


def get_classificacao_label(code: str | int) -> str:
    """Return human-readable label for a classificacao_receita code."""
    return _format_label(code, "classificacao_receita.yaml")


def get_gasto_label(code: str | int) -> str:
    """Return human-readable label for a cdDescricaoGasto code."""
    return _format_label(code, "codigos_gasto.yaml")
