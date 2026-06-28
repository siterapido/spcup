"""Deriva status do processamento a partir do DB. Substitui status.json.

Uso:
    .venv/bin/python scripts/status_from_db.py --uf BA --ano 2025
    .venv/bin/python scripts/status_from_db.py --uf BA --ano 2025 --escopo campina-grande
    .venv/bin/python scripts/status_from_db.py --uf BA --ano 2025 --json

Por padrão usa o DB canônico (tse_io.DB_PATH).
Para outro DB, usar --db PATH.
"""
import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from tse_io import DB_PATH


def derivar(db_path: Path, uf: str, ano: int, escopo: str = "") -> dict:
    con = sqlite3.connect(db_path)
    escopo_s = str(escopo or "").strip()
    try:
        if not escopo_s:
            rows = con.execute("""
                SELECT m.mes_slug,
                       COUNT(DISTINCT pe.id) AS prontas,
                       COUNT(DISTINCT b.id) AS bloqueadas,
                       COUNT(DISTINCT pm.id) AS processamentos
                FROM mes m
                JOIN prestacao p ON m.prestacao_id = p.id
                LEFT JOIN prontas_exportar pe ON pe.mes_id = m.id
                LEFT JOIN bloqueadas b ON b.mes_id = m.id
                LEFT JOIN processamento_mes pm ON pm.mes_id = m.id
                WHERE p.estado_uf = ? AND p.ano = ? AND (p.escopo IS NULL OR p.escopo = '')
                GROUP BY m.mes_slug
                ORDER BY m.id
            """, (uf, ano)).fetchall()
        else:
            rows = con.execute("""
                SELECT m.mes_slug,
                       COUNT(DISTINCT pe.id) AS prontas,
                       COUNT(DISTINCT b.id) AS bloqueadas,
                       COUNT(DISTINCT pm.id) AS processamentos
                FROM mes m
                JOIN prestacao p ON m.prestacao_id = p.id
                LEFT JOIN prontas_exportar pe ON pe.mes_id = m.id
                LEFT JOIN bloqueadas b ON b.mes_id = m.id
                LEFT JOIN processamento_mes pm ON pm.mes_id = m.id
                WHERE p.estado_uf = ? AND p.ano = ? AND p.escopo = ?
                GROUP BY m.mes_slug
                ORDER BY m.id
            """, (uf, ano, escopo_s)).fetchall()
    finally:
        con.close()
    return {
        "uf": uf,
        "ano": ano,
        "escopo": escopo,
        "db": str(db_path),
        "gerado_em": datetime.now().isoformat() + "Z",
        "meses": {
            slug: {
                "prontas": p,
                "bloqueadas": b,
                "processamentos": proc,
            }
            for slug, p, b, proc in rows
        },
        "totais": {
            "meses_com_dados": len(rows),
            "total_prontas": sum(r[1] for r in rows),
            "total_bloqueadas": sum(r[2] for r in rows),
        },
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--uf", required=True, help="Ex: BA, SC, PB")
    ap.add_argument("--ano", type=int, required=True)
    ap.add_argument("--escopo", default="", help="Vazio para estadual")
    ap.add_argument("--db", type=Path, default=DB_PATH)
    ap.add_argument("--json", action="store_true", help="Output em JSON")
    args = ap.parse_args()

    if not args.db.exists():
        print(f"❌ DB não encontrado: {args.db}", file=sys.stderr)
        sys.exit(1)

    status = derivar(args.db, args.uf, args.ano, args.escopo)

    if args.json:
        print(json.dumps(status, ensure_ascii=False, indent=2))
    else:
        print(f"DB: {status['db']}")
        print(f"UF={status['uf']} Ano={status['ano']} Escopo='{status['escopo']}'")
        print(f"Gerado em: {status['gerado_em']}")
        print()
        print(f"{'Mês':<12} {'Prontas':>8} {'Bloqueadas':>11} {'Proc':>5}")
        print("-" * 40)
        for slug, s in status["meses"].items():
            print(f"{slug:<12} {s['prontas']:>8} {s['bloqueadas']:>11} {s['processamentos']:>5}")
        print("-" * 40)
        t = status["totais"]
        print(f"{'TOTAL':<12} {t['total_prontas']:>8} {t['total_bloqueadas']:>11} {''}")


if __name__ == "__main__":
    main()
