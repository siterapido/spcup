"""XSD validation for SPCA export bundles."""

from __future__ import annotations

from pathlib import Path

from spc_up.spca.validate import SchemaName, validate_xml


class XsdValidationError(Exception):
    """Raised when one or more exported XMLs fail XSD validation."""

    def __init__(self, errors_by_file: dict[str, list[str]]) -> None:
        self.errors_by_file = errors_by_file
        invalid = {name: errs for name, errs in errors_by_file.items() if errs}
        super().__init__(f"XSD validation failed for {len(invalid)} file(s)")


def validate_spca_exports(
    files: list[tuple[SchemaName, Path]],
) -> dict[str, list[str]]:
    """Validate each XML against its schema; returns errors keyed by filename."""
    return {
        path.name: validate_xml(path, schema_name=schema)
        for schema, path in files
    }


def require_valid_xsd(validation: dict[str, list[str]]) -> None:
    """Raise XsdValidationError if any file has XSD errors."""
    invalid = {name: errs for name, errs in validation.items() if errs}
    if invalid:
        raise XsdValidationError(invalid)
