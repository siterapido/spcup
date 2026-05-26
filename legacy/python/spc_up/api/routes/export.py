"""SPCA XML export route."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from spc_up.api.deps import get_db
from spc_up.models.entities import DiretorioEstadual
from spc_up.services.export.aplicacao import build_aplicacao_xml
from spc_up.services.export.doacao import build_doacao_xml
from spc_up.services.export.guard import can_export
from spc_up.services.export.origem import build_origem_xml
from spc_up.services.export.validation import (
    XsdValidationError,
    require_valid_xsd,
    validate_spca_exports,
)
from spc_up.spca.validate import SchemaName

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("/{uf}/{exercicio}")
def export_spca_zip(
    uf: str,
    exercicio: int,
    session: Session = Depends(get_db),
) -> StreamingResponse:
    uf = uf.upper()
    if not can_export(session, uf, exercicio):
        raise HTTPException(
            403,
            detail="Exportação bloqueada: existem pendências ou bloqueio_export neste UF/exercício.",
        )

    diretorio = session.scalar(select(DiretorioEstadual).where(DiretorioEstadual.uf == uf))
    if diretorio is None:
        raise HTTPException(404, f"Diretório estadual não cadastrado para UF={uf}")

    cnpj = diretorio.cnpj_prestador
    paths: list[tuple[SchemaName, Path]] = [
        ("origem", build_origem_xml(session, uf, exercicio, cnpj)),
        ("aplicacao", build_aplicacao_xml(session, uf, exercicio, cnpj)),
        ("doacao", build_doacao_xml(session, uf, exercicio, cnpj)),
    ]

    try:
        validacao = validate_spca_exports(paths)
        require_valid_xsd(validacao)
    except XsdValidationError as exc:
        raise HTTPException(
            422,
            detail={
                "message": "XML inválido contra XSD SPCA; exportação não publicada.",
                "errors": exc.errors_by_file,
            },
        ) from exc

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for _, path in paths:
            zf.write(path, arcname=path.name)
        zf.writestr("validacao.json", json.dumps(validacao, ensure_ascii=False, indent=2))

    buffer.seek(0)
    filename = f"spca_{uf}_{exercicio}.zip"
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
