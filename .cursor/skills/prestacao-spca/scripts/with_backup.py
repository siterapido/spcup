"""Decorator que faz backup automático antes de operações mutantes.

Uso:
    @with_backup("/path/to/db.sqlite")
    def minha_funcao(db_path):
        ...  # mutações no DB

    minha_funcao()  # target é injetado como primeiro argumento posicional

Comportamento:
- Antes da função: copia target → target.bak-<timestamp>
- Após sucesso: deixa backup no lugar
- Em exceção: restaura target e remove backup
- Se target não existe: levanta FileNotFoundError antes de qualquer operação

Importante: o decorator faz backup do estado em DISCO no momento da chamada.
Se a função já abriu o arquivo/DB antes, o backup não captura o estado em memória.

O decorator injeta `target` como primeiro argumento posicional da função
decorada. Se a função decorada tem assinatura `def f(path)` e é chamada
sem args, recebe `target` automaticamente. Se a função decorada não
espera o path, ela simplesmente o ignora.
"""
import shutil
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Callable


def with_backup(target: str | Path):
    target = Path(target)
    def decorator(func: Callable):
        @wraps(func)
        def wrapper(*args, **kwargs):
            if not target.exists():
                raise FileNotFoundError(f"with_backup: target não existe: {target}")
            ts = datetime.now().strftime("%Y%m%d-%H%M%S")
            backup_path = target.with_name(f"{target.name}.bak-{ts}")
            shutil.copy2(target, backup_path)
            try:
                return func(target, *args, **kwargs)
            except Exception:
                # restaura do backup e remove
                shutil.copy2(backup_path, target)
                backup_path.unlink()
                raise
        return wrapper
    return decorator
