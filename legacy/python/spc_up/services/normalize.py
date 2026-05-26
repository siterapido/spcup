"""CPF, CNPJ, and name normalization for SPCA import."""

import re
import unicodedata

_CNPJ_TSE_PATTERN = re.compile(r"^[A-Z0-9]{12}[0-9]{2}$")


def _cpf_check_digits(cpf: str) -> bool:
    if cpf == cpf[0] * 11:
        return False

    for position in (9, 10):
        weights = range(position + 1, 1, -1)
        total = sum(int(cpf[index]) * weight for index, weight in enumerate(weights))
        expected = 0 if total % 11 < 2 else 11 - (total % 11)
        if int(cpf[position]) != expected:
            return False
    return True


def normalize_cpf(value: str) -> str:
    """Strip mask, validate check digits, return 11 digits or raise ValueError."""
    cpf = re.sub(r"\D", "", value)
    if len(cpf) != 11:
        raise ValueError("CPF inválido: deve conter 11 dígitos")
    if not _cpf_check_digits(cpf):
        raise ValueError("CPF inválido: dígitos verificadores incorretos")
    return cpf


def normalize_cnpj(value: str) -> str:
    """Strip mask and validate TSE alphanumeric pattern [A-Z0-9]{12}[0-9]{2}."""
    cnpj = re.sub(r"[^A-Za-z0-9]", "", value).upper()
    if not _CNPJ_TSE_PATTERN.fullmatch(cnpj):
        raise ValueError("CNPJ inválido: padrão TSE não atendido")
    return cnpj


def normalize_name(value: str, *, remove_accents: bool = True) -> str:
    """Uppercase, collapse whitespace, optionally remove accents."""
    text = " ".join(value.split())
    if remove_accents:
        text = unicodedata.normalize("NFD", text)
        text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return text.upper()
