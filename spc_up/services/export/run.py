"""Export SPCA XML bundle for a UF/exercicio."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from spc_up.models.entities import DiretorioEstadual
from spc_up.services.export.aplicacao import build_aplicacao_xml
from spc_up.services.export.doacao import build_doacao_xml
from spc_up.services.export.guard import can_export
from spc_up.services.export.origem import build_origem_xml
from spc_up.spca.validate import SchemaName, validate_xml


def _get_diretorio(session: Session, uf: str) -> DiretorioEstadual:
    diretorio = session.execute(
        select(DiretorioEstadual).where(DiretorioEstadual.uf == uf.upper())
    ).scalar_one_or_none()
    if diretorio is None:
        raise ValueError(f"Diretorio estadual not found for UF={uf}")
    return diretorio


def export_bundle(
    session: Session,
    uf: str,
    exercicio: int,
    out_dir: str | Path,
) -> list[Path]:
    """Build XML exports and copy them to out_dir. Raises if export is blocked."""
    uf = uf.upper()
    if not can_export(session, uf=uf, exercicio=exercicio):
        raise RuntimeError(
            f"Export blocked for {uf}/{exercicio}: resolve pendencias before exporting"
        )

    diretorio = _get_diretorio(session, uf)
    cnpj = diretorio.cnpj_prestador

    built = [
        build_origem_xml(session, uf, exercicio, cnpj),
        build_aplicacao_xml(session, uf, exercicio, cnpj),
        build_doacao_xml(session, uf, exercicio, cnpj),
    ]

    destination = Path(out_dir)
    destination.mkdir(parents=True, exist_ok=True)

    copied: list[Path] = []
    validation: dict[str, list[str]] = {}
    schema_map: dict[str, SchemaName] = {
        "origem": "origem",
        "aplicacao": "aplicacao",
        "doacao": "doacao",
    }

    for source in built:
        target = destination / source.name
        shutil.copy2(source, target)
        copied.append(target)
        schema_key = next((k for k in schema_map if k in source.stem), None)
        if schema_key:
            validation[source.name] = validate_xml(target, schema_name=schema_map[schema_key])

    validacao_path = destination / "validacao.json"
    validacao_path.write_text(json.dumps(validation, indent=2), encoding="utf-8")
    copied.append(validacao_path)
    return copied
