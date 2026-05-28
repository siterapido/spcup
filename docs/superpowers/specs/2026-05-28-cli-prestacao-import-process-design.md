# CLI — Importação e processamento de prestação (Design)

**Data:** 2026-05-28  
**Cliente:** Unidade Popular (UP) — SPC UP  
**Status:** Aprovado para implementação  
**Relacionado:**
- [2026-05-25-spc-up-prestacao-contas-design.md](./2026-05-25-spc-up-prestacao-contas-design.md)
- [2026-05-25-nextjs-vercel-neon-migration-design.md](./2026-05-25-nextjs-vercel-neon-migration-design.md)
- [2026-05-26-cadastro-pf-pj-design.md](./2026-05-26-cadastro-pf-pj-design.md)
- [2026-05-26-consolidacao-extratos-design.md](./2026-05-26-consolidacao-extratos-design.md)

---

## 1. Resumo executivo

Estender o `spc-up` para cobrir **importação e processamento** do fluxo de prestação de contas, enquanto **revisão (kanban), aprovação de consolidação e export SPCA** permanecem na **web**.

A sessão de prestação é **criada no wizard web**; a CLI recebe `--sessao <uuid>` e executa upload + processamento PDF + consolidação automática (quando aplicável), reutilizando as mesmas funções de `@spc-up/core` que as rotas `apps/web/app/api/prestacao/*`.

Inclui **importação de cadastro PF/PJ** via planilha e **instalação facilitada** do CLI (macOS, Linux, Windows e CI) como pacote npm publicado, sem exigir clone do monorepo.

---

## 2. Decisões de produto

| Tema | Decisão |
|------|---------|
| Escopo CLI | Importação + processamento |
| Escopo web | Wizard (criar sessão), kanban, aprovar consolidação, export ZIP |
| Sessão | Web cria; CLI obrigatoriamente anexa com `--sessao` |
| Cadastro | Comando CLI `cadastro import` (paridade com `/api/pessoas/import`) |
| PDF | CLI processa todas as páginas automaticamente; status `VERIFICAR` revisado no kanban web |
| Consolidação | CLI executa `consolidateSession` após PDFs se `consolidarExtratos` e ≥2 PDFs; aprovação/rejeição de pares só na web |
| Instalação | Fase 1: pacote npm `@spc-up/cli` + scripts `install.sh` / `install.ps1`; Node 20+ em todas as plataformas; CI usa o mesmo pacote |
| Binário standalone | Fase 2 opcional (somente se Node for inviável na prática) |
| Comandos legados | Manter `ingest`, `pendencias`, `confirm`, `export`, `validate-xsd` com deprecação na help; fluxo oficial = sessão + web |

---

## 3. Fluxo operacional

```text
[Web]  /prestacao/nova → POST /api/prestacao/sessoes → sessaoId (UUID)
         │
         ├─ (recomendado) [CLI] spc-up cadastro import --uf … --exercicio … --file pessoas.xlsx
         │
[CLI]    spc-up prestacao upload --sessao <id> --path ./lote/
         │    OFX/XLS → ingestFileBuffer (imediato, como upload web)
         │    PDF     → armazenarPdfIngestBuffer (modo armazenar, sem extrair ainda)
         │
[CLI]    spc-up prestacao process --sessao <id>
         │    Para cada arquivo PDF: todas páginas pendentes → processarPaginaPdfExtrato
         │    Se sessão.consolidarExtratos && pdfCount ≥ 2 → consolidateSession
         │    Resumo: movimentações criadas, páginas VERIFICAR/ERRO, eventos de consolidação
         │
[Web]    /prestacao/<id>/kanban        → revisar, vincular pessoa, confirmar
[Web]    /prestacao/<id>/consolidacao  → aprovar/rejeitar pares (se houver eventos)
[Web]    Export ZIP                     → GET /api/prestacao/sessoes/[id]/export
```

**Ordem recomendada:** cadastro (CLI ou web) → criar sessão (web) → upload + process (CLI) → kanban/export (web).

---

## 4. Comandos

### 4.1 Novos (fluxo oficial)

| Comando | Parâmetros obrigatórios | Função core |
|---------|-------------------------|-------------|
| `cadastro import` | `--uf`, `--exercicio`, `--file` | `parseCadastroSpreadsheet`, `importCadastroBatch` |
| `prestacao upload` | `--sessao`, `--path` | `getSessao`, `prestadorFromSessao`, `ingestFileBuffer`, `armazenarPdfIngestBuffer` |
| `prestacao process` | `--sessao` | `processarPaginaPdfExtrato` (loop), `consolidateSession` (condicional) |
| `prestacao run` | `--sessao`, `--path` | `upload` + `process` em sequência (atalho operacional) |
| `prestacao status` | `--sessao` | leituras agregadas (arquivos, páginas, movimentações, consolidação) |

**Flags comuns (todos os comandos de prestação/cadastro):**

- `--env-file <path>` — carrega `.env` antes de `getDb()` (default sugerido: `~/.spc-up/.env`)
- `--json` — saída estruturada em `status`, `process`, `upload` (para CI)

**Flags opcionais:**

- `cadastro import --dry-run` — parse + validação sem persistir
- `prestacao process --skip-consolidacao` — não chama `consolidateSession` mesmo com flag na sessão

### 4.2 Legado (mantidos, deprecados)

| Comando | Nota |
|---------|------|
| `ingest --uf --exercicio --path` | Sem sessão; aviso stderr: usar `prestacao upload --sessao` |
| `pendencias`, `confirm`, `export`, `validate-xsd` | Úteis para scripts/CI; export principal é web |

### 4.3 Validações pré-execução

- `getSessao` retorna 404 → exit 1, mensagem clara
- Sessão sem `diretorioEstadual` / prestador resolvível → exit 1
- `upload`: extensões `.ofx`, `.xlsx`, `.xls`, `.pdf` (mesmo conjunto da API)
- `process`: se não houver PDF pendente, exit 0 com aviso (idempotente)
- `cadastro import`: mesmas regras de parse/erro da API web (linhas inválidas reportadas, não abortar lote inteiro salvo erro fatal)

### 4.4 Saída de `prestacao process` (exemplo humano)

```text
Sessão: 8f3c…  UF=BA  exercício=2025  consolidarExtratos=true

PDF extrato-jan.pdf (3 páginas)
  p.1 OK — 12 movimentações
  p.2 VERIFICAR — 8 movimentações (revisar no kanban)
  p.3 OK — 5 movimentações

Consolidação: executada — 4 eventos gerados (aprovar em /prestacao/8f3c…/consolidacao)

Próximo passo: https://<AUTH_URL>/prestacao/8f3c…/kanban
```

URL do kanban: montada a partir de `AUTH_URL` no env ou impressa só com o path relativo se `AUTH_URL` ausente.

---

## 5. Arquitetura

```text
apps/cli/src/
  main.ts                 # Commander: comandos novos + legado
  commands/
    cadastro-import.ts
    prestacao-upload.ts
    prestacao-process.ts
    prestacao-run.ts
    prestacao-status.ts
  lib/
    load-env.ts           # --env-file, ~/.spc-up/.env
    sessao-context.ts     # getSessao + prestador + guards
    format-output.ts      # human | json

packages/core/            # sem duplicar lógica; mesmas funções da web
packages/db/              # getDb() via DATABASE_URL
```

**Princípio:** handlers CLI são adaptadores finos (argv → core → stdout/stderr). Nenhuma regra de negócio nova no CLI.

**Upload PDF:** replicar ramo `modo=armazenar` de `POST /api/prestacao/sessoes/[id]/upload` — não chamar extração no upload.

**Process PDF:** replicar loop de `use-prestacao-submit` / `POST .../paginas/[p]/processar` — processar todas as páginas em ordem até esgotar pendentes.

**Consolidação:** chamar `consolidateSession(db, sessaoId)`; se `skipped` (menos de 2 PDFs, etc.), logar motivo sem falhar.

---

## 6. Instalação facilitada (Fase 1)

### 6.1 Pacote publicado

- Nome: `@spc-up/cli` (registry: GitHub Packages da org UP ou npm privado).
- Build: `tsup` com `noExternal: [/^@spc-up\//]` (bundle monorepo workspace no artefato publicado).
- `bin`: `spc-up` → `dist/main.js`.
- `files` no package publicado: apenas `dist/` + `README.md` CLI.

### 6.2 Instalação local

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/<org>/spc-up/main/scripts/install-spc-up.sh | bash
# ou: npm install -g @spc-up/cli
spc-up --version
cp ~/.spc-up/.env.example ~/.spc-up/.env   # editar DATABASE_URL, OPENROUTER_*, STORAGE_ROOT
```

**Windows (PowerShell):**

```powershell
.\scripts\install-spc-up.ps1
spc-up --version
```

Scripts verificam **Node ≥ 20**, instalam o pacote global e criam diretório `~/.spc-up/` com `.env.example`.

### 6.3 CI (GitHub Actions)

```yaml
- run: npm install -g @spc-up/cli@${{ github.sha }}   # ou versão publicada
- run: spc-up cadastro import --uf BA --exercicio 2025 --file ./fixtures/cadastro.xlsx --env-file .env
- run: spc-up prestacao run --sessao ${{ env.SESSAO_ID }} --path ./fixtures/extratos/ --json
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

### 6.4 Variáveis de ambiente obrigatórias

| Variável | Comandos |
|----------|----------|
| `DATABASE_URL` | Todos |
| `STORAGE_ROOT` | `prestacao upload` (default `./data/uploads`) |
| `OPENROUTER_API_KEY` | PDF em `process` |
| `OPENROUTER_PDF_MODEL`, `MAX_EXTRATO_PAGES`, etc. | PDF (opcionais, ver `.env.example`) |
| `AUTH_URL` | Opcional — link kanban na saída |

### 6.5 Fase 2 (opcional, fora do escopo v1)

Binários standalone (win/mac/linux) sem Node — somente se feedback da equipe exigir após Fase 1.

---

## 7. Erros e exit codes

| Situação | Exit code | Comportamento |
|----------|-----------|---------------|
| Sessão/arquivo não encontrado | 1 | Mensagem + stderr |
| Erro OpenRouter / PDF | 1 por arquivo ou continuar lote | Mesmo padrão do upload web: registrar ERRO em `arquivo_ingestao` / página, seguir outros arquivos quando possível |
| `consolidateSession` skipped | 0 | Informar `reason` (ex. `LESS_THAN_TWO_PDF`) |
| XSD / export legado | 1 | Inalterado nos comandos deprecados |
| Sucesso parcial upload | 0 | Listar sucessos e erros por arquivo; exit 1 se **nenhum** arquivo ok |

Logs: reutilizar `ingestLog` do core; CLI não duplica mascaramento LGPD.

---

## 8. Testes

| Camada | O que cobrir |
|--------|----------------|
| `packages/core` | Já cobre ingest/cadastro/consolidação — manter |
| `apps/cli` | Testes de handlers com DB mock + fixtures; spawn `node dist/main.js` em smoke |
| Integração | Opcional `SPC_CLI_INTEGRATION=1`: sessão fixture + upload process contra Neon de teste |
| Publicação | CI: build + `node dist/main.js --help` + instalar pacote tarball em job isolado |

Não exigir `xmllint` nos novos comandos (validação XSD permanece em `validate-xsd` / export legado).

---

## 9. Fora de escopo (v1)

- UI terminal para revisão de imagem PDF (paridade visual com `PaginaVerificarPanel`)
- Kanban, PATCH movimentação, confirm em massa, export ZIP — **web**
- Aprovar/rejeitar eventos de consolidação — **web**
- Criar sessão via CLI
- Auth/sessão cookie na CLI (acesso direto ao Neon; equipe nacional de confiança, alinhado à spec de migração)
- Publicação npm pública sem controle de org (usar registry privado UP)

---

## 10. Atualização de documentação existente

- `README.md` § CLI — fluxo sessão + instalação global
- `docs/piloto-checklist.md` — passo CLI upload/process após criar sessão na web
- `2026-05-26-cadastro-pf-pj-design.md` §2 — remover “CLI dedicada” de “fora v1” (nota de supersessão por este doc)

---

## 11. Riscos

| Risco | Mitigação |
|-------|-----------|
| Divergência CLI vs API upload | Extrair helper `uploadFilesToSessao` em `packages/core` usado por API e CLI |
| Timeout PDF longo no terminal | Progresso linha a linha; documentar tempo esperado; mesmo timeout env que web |
| Pacote npm sem workspace | Bundle tsup obrigatório no publish |
| Windows paths | `path.resolve` + testes em CI windows-latest |
| Operador esquece cadastro | Mensagem em `process` se cadastro vazio na UF (warning, não bloqueio) |

---

## 12. Critérios de aceite

1. Operador cria sessão na web, roda `prestacao run --sessao <id> --path ./lote/` em máquina com CLI instalado via script (sem clone).
2. Movimentações aparecem no kanban web com mesmos status que fluxo upload+process pela UI.
3. `cadastro import` produz mesmos contadores que import web na mesma planilha.
4. Com 2+ PDFs e `consolidarExtratos`, eventos de consolidação existem após `process`; aprovação manual na web.
5. CI instala pacote e executa `prestacao status --json` com exit 0 em fixture.

---

*Documento gerado no brainstorming 2026-05-28. Próximo passo: plano de implementação (`writing-plans`).*
