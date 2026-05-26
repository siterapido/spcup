"""Tests for XSD validation gate on export."""

from __future__ import annotations

import pytest

from spc_up.services.export.validation import (
    XsdValidationError,
    require_valid_xsd,
    validate_spca_exports,
)


def test_require_valid_xsd_passes_when_empty_errors():
    require_valid_xsd({"origem.xml": []})


def test_require_valid_xsd_raises_on_errors():
    with pytest.raises(XsdValidationError) as exc_info:
        require_valid_xsd({"origem.xml": ["line 1: invalid"]})
    assert "origem.xml" in exc_info.value.errors_by_file


def test_validate_spca_exports_empty_list():
    assert validate_spca_exports([]) == {}
