"""Upload and ingest routes."""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from spc_up.api.deps import get_db
from spc_up.services.ingest.pipeline import get_diretorio, ingest_file

router = APIRouter(prefix="/api", tags=["upload"])

_ALLOWED = {".ofx", ".xlsx", ".xls"}


@router.post("/upload")
async def upload_file(
    uf: str = Form(...),
    exercicio: int = Form(...),
    file: UploadFile = File(...),
    session: Session = Depends(get_db),
) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _ALLOWED:
        raise HTTPException(400, f"Formato não suportado. Use: {', '.join(sorted(_ALLOWED))}")

    diretorio = get_diretorio(session, uf)
    if diretorio is None:
        raise HTTPException(404, f"Diretório estadual não cadastrado para UF={uf.upper()}")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        created = ingest_file(
            session,
            diretorio=diretorio,
            uf=uf.upper(),
            exercicio=exercicio,
            source=tmp_path,
        )
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)

    return {
        "uf": uf.upper(),
        "exercicio": exercicio,
        "arquivo": file.filename,
        "movimentacoes_criadas": len(created),
        "ids": [str(m.id) for m in created],
    }
