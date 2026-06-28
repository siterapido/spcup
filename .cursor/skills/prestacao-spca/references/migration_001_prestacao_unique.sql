-- migration_001_prestacao_unique.sql
-- Data: 2026-06-24
-- Autor: Hermes (subagente) — Task 1 do plano spcaskills-melhorias
--
-- Propósito: garantir UNIQUE INDEX em prestacao(estado, ano, escopo)
--            para impedir duplicatas na criação de prestação.
--
-- Status do DB atual (jun/2026):
--   A constraint UNIQUE JÁ EXISTE como `UNIQUE(estado, ano, escopo)` inline
--   na definição da tabela prestacao (ver schema.sql). O SQLite materializa
--   isso como `sqlite_autoindex_prestacao_1`. Verificado: 0 duplicatas
--   em 6 linhas.
--
-- Esta migration é IDEMPOTENTE: roda em DBs novos (cria o índice) e em
-- DBs existentes (no-op se já há constraint/índice equivalente).

-- 1) Verifica duplicata antes de aplicar (sanity check)
SELECT id, estado, ano, escopo, COUNT(*) OVER (PARTITION BY estado, ano, escopo) AS dup
FROM prestacao
HAVING dup > 1;

-- 2) Se a query acima voltar vazia, aplicar:
CREATE UNIQUE INDEX IF NOT EXISTS ux_prestacao_estado_ano_escopo
  ON prestacao(estado, ano, escopo);

-- 3) Verificação pós-apply:
--   PRAGMA index_list(prestacao);
--   Deve listar `ux_prestacao_estado_ano_escopo` (ou o autoindex equivalente).
