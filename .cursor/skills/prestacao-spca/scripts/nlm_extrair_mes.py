#!/usr/bin/env python3
"""Extrai PDFs do mês via NotebookLM e grava JSON em {Estado}/{ano}/{mes}/.cache/."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib_nlm import main

if __name__ == "__main__":
    raise SystemExit(main())
