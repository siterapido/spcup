"""Loader de constants.yaml. Cache em memória."""
import yaml
from pathlib import Path

CONSTANTS_PATH = Path(__file__).parent.parent / "references" / "constants.yaml"

_cache = None


def load_constants():
    global _cache
    if _cache is None:
        _cache = yaml.safe_load(CONSTANTS_PATH.read_text(encoding="utf-8"))
    return _cache


def get_prestacao(estado: str, escopo: str = "") -> dict:
    """Retorna {cnpj_prestador, modelo_extrato, ...} para estado/escopo."""
    cfg = load_constants()
    if escopo:
        return cfg["estados"][estado]["municipios"][escopo]
    if estado == "Paraíba":
        return cfg["estados"][estado]["estadual"]
    return cfg["estados"][estado]


def get_xml_defaults(modelo_extrato: str) -> dict:
    """Retorna defaults XML (banco, natureza, etc) por modelo de extrato."""
    cfg = load_constants()
    if modelo_extrato == "bb_unificado":
        return cfg["xml_defaults_bb"]
    return cfg["xml_defaults_caixa"]
