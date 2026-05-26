"""FastAPI application for SPC UP pilot."""

from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from spc_up.api.deps import get_db
from spc_up.api.routes import export, movimentacoes, upload
from spc_up.services.export.guard import can_export

TEMPLATES = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))

app = FastAPI(title="SPC UP", version="0.1.0")
app.include_router(upload.router)
app.include_router(movimentacoes.router)
app.include_router(export.router)


@app.get("/", response_class=HTMLResponse)
def dashboard(
    request: Request,
    uf: str = "SP",
    exercicio: int = 2025,
    session: Session = Depends(get_db),
) -> HTMLResponse:
    uf = uf.upper()
    exportavel = can_export(session, uf, exercicio)
    return TEMPLATES.TemplateResponse(
        request,
        "dashboard.html",
        {"uf": uf, "exercicio": exercicio, "exportavel": exportavel},
    )


@app.get("/movimentacoes", response_class=HTMLResponse)
def movimentacoes_page(request: Request, uf: str = "SP", exercicio: int = 2025) -> HTMLResponse:
    return TEMPLATES.TemplateResponse(
        request,
        "movimentacoes.html",
        {"uf": uf.upper(), "exercicio": exercicio},
    )
