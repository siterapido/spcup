# @spc-up/cli

CLI para **importação e processamento** de prestação de contas. Revisão (kanban) e export SPCA ficam na web.

## Instalação

```bash
./bin/spcup install
```

Depois, de qualquer pasta: `spcup <comando>`.

Sem instalar global: `./bin/spcup` ou `pnpm spcup` na raiz do repo.

## Configuração

Copie e edite `~/.spc-up/.env` (criado pelo script de instalação):

- `DATABASE_URL` — Neon Postgres
- `OPENROUTER_API_KEY` — obrigatório para PDF
- `STORAGE_ROOT` — default `./data/uploads`
- `AUTH_URL` — opcional, para link do kanban na saída

O CLI mescla automaticamente, nesta ordem (o último vence): `~/.spc-up/.env` → `.env` → `.env.local` → `--env-file` (se passado). Valores vazios (`DATABASE_URL=`) são ignorados.

Exemplo após `vercel env pull .env.local`:

```bash
spcup prestacao run --sessao <uuid> --path ./lote/
# não precisa --env-file se .env e .env.local estão na raiz do repo
```

## Fluxo operacional

1. **Web:** criar sessão em `/prestacao/nova` → copiar UUID
2. **CLI:** importar cadastro (opcional, recomendado antes dos extratos)
3. **CLI:** upload + processamento dos arquivos
4. **Web:** kanban → confirmar → export ZIP

```bash
spcup cadastro import --uf BA --exercicio 2025 --file pessoas.xlsx

spcup prestacao run --sessao 8f3c0000-0000-4000-8000-000000000000 --path ./lote/

spcup prestacao status --sessao 8f3c0000-0000-4000-8000-000000000000
```

## Comandos

| Comando | Descrição |
|---------|-----------|
| `cadastro import` | Planilha PF/PJ |
| `prestacao upload` | Envia OFX/Excel/PDF (PDF armazenado) |
| `prestacao process` | Processa PDFs + consolidação automática |
| `prestacao run` | Upload + process |
| `prestacao status` | Resumo da sessão (`--json` para CI) |

Comandos legados (`ingest`, `export`, …) permanecem para scripts antigos; o fluxo oficial usa sessão + web.

## CI

```yaml
- run: pnpm --filter @spc-up/cli build
- run: node apps/cli/dist/main.js prestacao status --sessao ${{ env.SESSAO_ID }} --json --env-file .env
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```
