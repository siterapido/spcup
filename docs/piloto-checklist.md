# Checklist piloto SPC UP (1 semana)

## Pré-requisitos

- [ ] Docker Desktop rodando → `docker compose up -d`
- [ ] `alembic upgrade head`
- [ ] `cp .env.example .env` com `OPENROUTER_API_KEY` se usar PDF
- [ ] CNPJs reais nos diretórios piloto: editar `scripts/seed_diretorios.py` ou banco
- [ ] XSDs em `spc_up/spca/schemas/` (origem, aplicacao, doacao)

## UFs piloto (escolher 2–3)

- [ ] UF 1: _______
- [ ] UF 2: _______
- [ ] UF 3: _______

## Fluxo E2E

1. [ ] `python scripts/seed_diretorios.py`
2. [ ] `spc-up ingest --uf XX --exercicio 2025 --path ./dados/`
3. [ ] `uvicorn spc_up.api.main:app --reload` → revisar em `/movimentacoes`
4. [ ] Confirmar lançamentos com score ≥ 0,85 (ou corrigir manualmente no banco)
5. [ ] `spc-up pendencias --uf XX --exercicio 2025 --output pendencias.csv` → enviar ao estado
6. [ ] `spc-up export --uf XX --exercicio 2025 --out ./export/`
7. [ ] Importar os 3 XMLs no SPCA Cadastro (homologação)
8. [ ] Registrar resultado abaixo

## Resultado

| UF | Ingest OK | Export OK | SPCA import OK | Observações |
|----|-----------|-----------|----------------|-------------|
|    |           |           |                |             |
|    |           |           |                |             |

## Critério de sucesso

- ≥ 80% movimentações estruturadas (OFX/Excel) com score ≥ 0,85 após revisão
- 3 XMLs validam no XSD e importam no SPCA sem erro crítico
