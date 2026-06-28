"""Helpers de I/O com encoding/formatos do TSE/SPCA.

Centraliza:
- Leitura de CSV exportado pelo SPCA (ISO-8859-1, 4 linhas de metadata, sep=';')
- Escrita de XML origemRecurso (ISO-8859-1, namespace preservado)
- Path canônico do projeto SPCA UP V2
"""
import csv
from pathlib import Path
from typing import Iterator

PROJECT_RAIZ = Path("/Volumes/SSDdoMarcos/Projetos/SPCA UP V2")
TSE_ENCODING = "iso-8859-1"
TSE_CSV_METADATA_LINES = 4

# DB canônico do projeto. Mutações são protegidas por @with_backup(DB_PATH).
DB_PATH = PROJECT_RAIZ / "resultados" / "spca_revisao.db"


def ler_csv_tse(path: Path) -> Iterator[list[str]]:
    """Lê CSV do SPCA/TSE. Pula 4 linhas de metadata. Encoding ISO-8859-1."""
    with open(path, encoding=TSE_ENCODING, newline="") as f:
        for _ in range(TSE_CSV_METADATA_LINES):
            next(f, None)
        reader = csv.reader(f, delimiter=";", quotechar='"')
        yield from reader


def escrever_xml_tse(path: Path, conteudo: str) -> None:
    """Escreve XML com encoding ISO-8859-1 declarado. Não usar ElementTree (renomeia ns)."""
    path.write_bytes(conteudo.encode(TSE_ENCODING))
