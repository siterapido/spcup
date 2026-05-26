"""Typer CLI entry point for spc-up."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Annotated

import typer
from sqlalchemy import select

from spc_up.db import session_scope
from spc_up.models.entities import DiretorioEstadual, Movimentacao, MovimentacaoStatus
from spc_up.services.export.aplicacao import build_aplicacao_xml
from spc_up.services.export.doacao import build_doacao_xml
from spc_up.services.export.guard import can_export
from spc_up.services.export.origem import build_origem_xml
from spc_up.services.ingest.pipeline import INGEST_EXTENSIONS, get_diretorio, ingest_file
from spc_up.services.confidence import evaluate_movimentacao
from spc_up.services.report.pendencias import generate_pendencias_csv
from spc_up.spca.validate import SchemaName, validate_xml

app = typer.Typer(
    name="spc-up",
    help="SPC UP — prestação de contas (ingestão, revisão e exportação SPCA).",
    no_args_is_help=True,
)


def _parse_uuid_list(ids: str) -> list[uuid.UUID]:
    parsed: list[uuid.UUID] = []
    for raw in ids.split(","):
        token = raw.strip()
        if not token:
            continue
        parsed.append(uuid.UUID(token))
    if not parsed:
        raise typer.BadParameter("Informe ao menos um UUID em --ids.")
    return parsed


def _collect_ingest_paths(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    if not path.is_dir():
        raise typer.BadParameter(f"Caminho não encontrado: {path}")

    files = sorted(
        p
        for p in path.iterdir()
        if p.is_file() and p.suffix.lower() in INGEST_EXTENSIONS
    )
    if not files:
        raise typer.BadParameter(
            f"Nenhum arquivo OFX/Excel em {path} (extensões: {', '.join(sorted(INGEST_EXTENSIONS))})."
        )
    return files


@app.command()
def ingest(
    uf: Annotated[str, typer.Option(help="UF do diretório estadual (ex.: SP).")],
    exercicio: Annotated[int, typer.Option(help="Ano de exercício.")],
    path: Annotated[Path, typer.Option(help="Arquivo ou pasta com OFX/Excel.")],
) -> None:
    """Ingerir extratos OFX ou planilhas Excel."""
    uf = uf.upper()
    sources = _collect_ingest_paths(path)

    total = 0
    with session_scope() as session:
        diretorio = get_diretorio(session, uf)
        if diretorio is None:
            typer.echo(f"Diretório estadual não cadastrado para UF={uf}.", err=True)
            raise typer.Exit(code=1)

        for source in sources:
            try:
                created = ingest_file(
                    session,
                    diretorio=diretorio,
                    uf=uf,
                    exercicio=exercicio,
                    source=source,
                )
                count = len(created)
                total += count
                typer.echo(f"{source.name}: {count} movimentação(ões)")
            except Exception as exc:
                typer.echo(f"{source.name}: ERRO — {exc}", err=True)

    typer.echo(f"Ingestão concluída: {total} movimentação(ões) em {len(sources)} arquivo(s).")


@app.command()
def pendencias(
    uf: Annotated[str, typer.Option(help="UF.")],
    exercicio: Annotated[int, typer.Option(help="Ano de exercício.")],
    output: Annotated[Path, typer.Option(help="Caminho do CSV de saída.")],
) -> None:
    """Gerar relatório CSV de pendências."""
    with session_scope() as session:
        count = generate_pendencias_csv(session, uf.upper(), exercicio, output)
    typer.echo(f"Pendências: {count} linha(s) → {output}")


@app.command()
def confirm(
    ids: Annotated[str, typer.Option(help="UUIDs separados por vírgula.")],
) -> None:
    """Confirmar movimentações para exportação."""
    id_list = _parse_uuid_list(ids)

    with session_scope() as session:
        confirmed = 0
        for mov_id in id_list:
            movimentacao = session.get(Movimentacao, mov_id)
            if movimentacao is None:
                typer.echo(f"Não encontrada: {mov_id}", err=True)
                continue
            evaluate_movimentacao(movimentacao)
            movimentacao.status = MovimentacaoStatus.CONFIRMADO.value
            confirmed += 1
        typer.echo(f"Confirmadas: {confirmed}/{len(id_list)}")


@app.command()
def export(
    uf: Annotated[str, typer.Option(help="UF.")],
    exercicio: Annotated[int, typer.Option(help="Ano de exercício.")],
    out: Annotated[Path, typer.Option(help="Diretório de saída dos XMLs.")],
) -> None:
    """Exportar os três XMLs SPCA (origem, aplicação, doação)."""
    uf = uf.upper()
    out.mkdir(parents=True, exist_ok=True)

    with session_scope() as session:
        if not can_export(session, uf, exercicio):
            typer.echo(
                "Exportação bloqueada: existem pendências ou bloqueio_export para este UF/exercício.",
                err=True,
            )
            raise typer.Exit(code=1)

        diretorio = session.scalar(select(DiretorioEstadual).where(DiretorioEstadual.uf == uf))
        if diretorio is None:
            typer.echo(f"Diretório estadual não cadastrado para UF={uf}.", err=True)
            raise typer.Exit(code=1)

        cnpj = diretorio.cnpj_prestador
        paths = [
            build_origem_xml(session, uf, exercicio, cnpj),
            build_aplicacao_xml(session, uf, exercicio, cnpj),
            build_doacao_xml(session, uf, exercicio, cnpj),
        ]

    for built in paths:
        target = out / built.name
        shutil.copy2(built, target)
        typer.echo(f"→ {target}")

    typer.echo("Exportação concluída.")


@app.command("validate-xsd")
def validate_xsd(
    file: Annotated[Path, typer.Option(help="Arquivo XML a validar.")],
    schema: Annotated[SchemaName, typer.Option(help="Schema: origem, aplicacao ou doacao.")],
) -> None:
    """Validar um XML contra o XSD SPCA correspondente."""
    if not file.is_file():
        typer.echo(f"Arquivo não encontrado: {file}", err=True)
        raise typer.Exit(code=1)

    errors = validate_xml(file, schema_name=schema)
    if errors:
        typer.echo(f"Inválido ({len(errors)} erro(s)):", err=True)
        for message in errors:
            typer.echo(f"  - {message}", err=True)
        raise typer.Exit(code=1)

    typer.echo(f"OK — {file} válido para schema '{schema}'.")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
