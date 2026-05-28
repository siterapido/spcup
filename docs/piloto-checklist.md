# Checklist piloto SPC UP (1 semana)

## Pré-requisitos

- [ ] Docker Desktop rodando → `docker compose up -d`
- [ ] `alembic upgrade head`
- [ ] `cp .env.example .env` com `OPENROUTER_API_KEY` se usar PDF
- [ ] CNPJs reais nos diretórios piloto: editar `scripts/seed-diretorios.ts` ou banco
- [ ] XSDs em `packages/spca/schemas/` (origem, aplicacao, doacao)

## UFs piloto (escolher 2–3)

- [ ] UF 1: _______
- [ ] UF 2: _______
- [ ] UF 3: _______

## Fluxo E2E

1. [ ] `./bin/spcup install` (depois: `spcup` de qualquer pasta)
2. [ ] `pnpm seed:diretorios` + configurar `~/.spc-up/.env`
3. [ ] **Web:** `/prestacao/nova` → criar sessão → copiar UUID
4. [ ] `spc-up cadastro import --uf XX --exercicio 2025 --file pessoas.xlsx` (se houver cadastro)
5. [ ] `spc-up prestacao run --sessao <uuid> --path ./dados/`
6. [ ] **Web:** `/prestacao/<uuid>/kanban` → revisar, vincular pessoa, confirmar
7. [ ] **Web:** export ZIP SPCA (se consolidação: aprovar em `/prestacao/<uuid>/consolidacao` antes)
8. [ ] Importar XMLs no SPCA Cadastro (homologação)
9. [ ] Registrar resultado abaixo

## Resultado

| UF | Ingest OK | Export OK | SPCA import OK | Observações |
|----|-----------|-----------|----------------|-------------|
|    |           |           |                |             |
|    |           |           |                |             |

## Critério de sucesso

- ≥ 80% movimentações estruturadas (OFX/Excel) com score ≥ 0,85 após revisão
- Extrato PDF 1–3 páginas; linhas sem CPF/CNPJ válido não viram movimentação
- 3 XMLs validam no XSD e importam no SPCA sem erro crítico
