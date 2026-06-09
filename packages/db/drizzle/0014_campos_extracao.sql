ALTER TABLE movimentacao
  ADD COLUMN IF NOT EXISTS campos_extracao jsonb NOT NULL DEFAULT '{}';

ALTER TABLE sessao_prestacao
  ADD COLUMN IF NOT EXISTS mes_referencia varchar(7);
