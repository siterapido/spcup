#!/usr/bin/env python3
"""Seed all 27 UFs with placeholder CNPJs — replace before production export."""

from __future__ import annotations

import sys

from sqlalchemy import select

from spc_up.db import session_scope
from spc_up.models.entities import DiretorioEstadual

# SUBSTITUIR pelos CNPJs reais de cada diretório estadual da UP antes do piloto SPCA.
UFS = [
    ("AC", "00000000000100", "Diretório Estadual UP — Acre"),
    ("AL", "00000000000101", "Diretório Estadual UP — Alagoas"),
    ("AP", "00000000000102", "Diretório Estadual UP — Amapá"),
    ("AM", "00000000000103", "Diretório Estadual UP — Amazonas"),
    ("BA", "00000000000104", "Diretório Estadual UP — Bahia"),
    ("CE", "00000000000105", "Diretório Estadual UP — Ceará"),
    ("DF", "00000000000106", "Diretório Estadual UP — Distrito Federal"),
    ("ES", "00000000000107", "Diretório Estadual UP — Espírito Santo"),
    ("GO", "00000000000108", "Diretório Estadual UP — Goiás"),
    ("MA", "00000000000109", "Diretório Estadual UP — Maranhão"),
    ("MT", "00000000000110", "Diretório Estadual UP — Mato Grosso"),
    ("MS", "00000000000111", "Diretório Estadual UP — Mato Grosso do Sul"),
    ("MG", "00000000000112", "Diretório Estadual UP — Minas Gerais"),
    ("PA", "00000000000113", "Diretório Estadual UP — Pará"),
    ("PB", "00000000000114", "Diretório Estadual UP — Paraíba"),
    ("PR", "00000000000115", "Diretório Estadual UP — Paraná"),
    ("PE", "00000000000116", "Diretório Estadual UP — Pernambuco"),
    ("PI", "00000000000117", "Diretório Estadual UP — Piauí"),
    ("RJ", "00000000000118", "Diretório Estadual UP — Rio de Janeiro"),
    ("RN", "00000000000119", "Diretório Estadual UP — Rio Grande do Norte"),
    ("RS", "00000000000120", "Diretório Estadual UP — Rio Grande do Sul"),
    ("RO", "00000000000121", "Diretório Estadual UP — Rondônia"),
    ("RR", "00000000000122", "Diretório Estadual UP — Roraima"),
    ("SC", "00000000000123", "Diretório Estadual UP — Santa Catarina"),
    ("SP", "00000000000124", "Diretório Estadual UP — São Paulo"),
    ("SE", "00000000000125", "Diretório Estadual UP — Sergipe"),
    ("TO", "00000000000126", "Diretório Estadual UP — Tocantins"),
]


def main() -> int:
    created = 0
    updated = 0
    with session_scope() as session:
        for uf, cnpj, nome in UFS:
            existing = session.scalar(select(DiretorioEstadual).where(DiretorioEstadual.uf == uf))
            if existing:
                existing.cnpj_prestador = cnpj
                existing.nome = nome
                existing.ativo = True
                updated += 1
            else:
                session.add(
                    DiretorioEstadual(uf=uf, cnpj_prestador=cnpj, nome=nome, ativo=True)
                )
                created += 1
    print(f"Seed concluído: {created} criados, {updated} atualizados.")
    print("IMPORTANTE: substitua CNPJs placeholder pelos CNPJs reais antes de exportar ao SPCA.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
