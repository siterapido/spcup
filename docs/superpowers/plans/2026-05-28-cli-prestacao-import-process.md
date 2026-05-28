# CLI — Importação e processamento de prestação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender `spc-up` para importar cadastro PF/PJ e processar arquivos de uma sessão de prestação criada na web (upload + PDF + consolidação), com instalação facilitada via pacote npm em macOS/Linux/Windows/CI.

**Architecture:** Extrair `uploadFilesToSessao` e `processSessaoPdfArquivos` em `packages/core/src/prestacao/*` (paridade API web + CLI). Handlers finos em `apps/cli/src/commands/*` com libs `load-env`, `sessao-context`, `format-output`. Web passa a chamar o helper de upload em vez de duplicar loop.

**Tech Stack:** TypeScript, Commander, `@spc-up/core`, `@spc-up/db`, Vitest, tsup (bundle publish), Node 20+.

**Spec:** [docs/superpowers/specs/2026-05-28-cli-prestacao-import-process-design.md](../specs/2026-05-28-cli-prestacao-import-process-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/core/src/prestacao/upload-files.ts` | `uploadFilesToSessao`, tipos de resultado |
| `packages/core/src/prestacao/process-sessao.ts` | `processSessaoPdfArquivos`, loop páginas + consolidação |
| `packages/core/src/prestacao/cli-status.ts` | `getPrestacaoCliStatus` — resumo para `prestacao status` |
| `packages/core/src/prestacao/upload-files.test.ts` | TDD upload helper |
| `packages/core/src/prestacao/process-sessao.test.ts` | TDD process helper |
| `apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts` | Refatorar para `uploadFilesToSessao` |
| `apps/cli/src/lib/load-env.ts` | `--env-file`, default `~/.spc-up/.env` |
| `apps/cli/src/lib/sessao-context.ts` | `requireSessaoContext` (getSessao + prestador) |
| `apps/cli/src/lib/format-output.ts` | human / `--json` |
| `apps/cli/src/lib/resolve-path-files.ts` | arquivo ou pasta → buffers |
| `apps/cli/src/commands/cadastro-import.ts` | `cadastro import` |
| `apps/cli/src/commands/prestacao-upload.ts` | `prestacao upload` |
| `apps/cli/src/commands/prestacao-process.ts` | `prestacao process` |
| `apps/cli/src/commands/prestacao-run.ts` | `prestacao run` |
| `apps/cli/src/commands/prestacao-status.ts` | `prestacao status` |
| `apps/cli/src/main.ts` | Registrar subcomandos + deprecação legado |
| `scripts/install-spc-up.sh` | Instalação macOS/Linux |
| `scripts/install-spc-up.ps1` | Instalação Windows |
| `scripts/spc-up.env.example` | Template `~/.spc-up/.env` |
| `apps/cli/README.md` | Doc instalação + fluxo sessão |
| `README.md` | Atualizar § CLI |
| `docs/piloto-checklist.md` | Passos CLI após wizard web |

---

### Task 1: Core — `uploadFilesToSessao`

**Files:**
- Create: `packages/core/src/prestacao/upload-files.ts`
- Create: `packages/core/src/prestacao/upload-files.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts`

- [ ] **Step 1: Write failing test**

`packages/core/src/prestacao/upload-files.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

const ingestFileBufferMock = vi.fn();
const armazenarPdfMock = vi.fn();

vi.mock("../ingest/pipeline", () => ({
  ingestFileBuffer: (...args: unknown[]) => ingestFileBufferMock(...args),
}));

vi.mock("../ingest/pdf-pagina", () => ({
  armazenarPdfIngestBuffer: (...args: unknown[]) => armazenarPdfMock(...args),
}));

import { uploadFilesToSessao } from "./upload-files";

describe("uploadFilesToSessao", () => {
  it("stores PDF in armazenar mode and ingests OFX immediately", async () => {
    ingestFileBufferMock.mockResolvedValue({ movimentacoes_criadas: 3, ids: [] });
    armazenarPdfMock.mockResolvedValue({
      arquivoId: "pdf-id",
      pageCount: 2,
      nome: "extrato.pdf",
    });

    const db = {} as never;
    const persistStorage = vi.fn(async (_p: string, _b: Buffer) => "/storage/x");

    const result = await uploadFilesToSessao(db, {
      sessaoId: "sess-1",
      diretorioEstadualId: "dir-1",
      uf: "BA",
      exercicio: 2025,
      prestador: {
        cnpjPrestador: "23738595000182",
        tipoPrestador: "ESTADUAL",
        sessaoPrestacaoId: "sess-1",
      },
      files: [
        { filename: "lanc.ofx", buffer: Buffer.from("ofx") },
        { filename: "extrato.pdf", buffer: Buffer.from("%PDF") },
      ],
      persistStorage,
    });

    expect(armazenarPdfMock).toHaveBeenCalledOnce();
    expect(ingestFileBufferMock).toHaveBeenCalledOnce();
    expect(result.arquivos).toHaveLength(2);
    expect(result.arquivos[1]?.modo).toBe("armazenar");
    expect(result.total_movimentacoes).toBe(3);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @spc-up/core test upload-files.test.ts`
Expected: FAIL — module `./upload-files` not found

- [ ] **Step 3: Implement `uploadFilesToSessao`**

`packages/core/src/prestacao/upload-files.ts`:

```typescript
import { randomUUID } from "node:crypto";
import path from "node:path";

import { sessaoPrestacao, SESSAO_STATUS, type Db } from "@spc-up/db";
import { eq } from "drizzle-orm";

import { classifyIngestError, ingestLog } from "../ingest/errors";
import { ingestFileBuffer } from "../ingest/pipeline";
import { armazenarPdfIngestBuffer } from "../ingest/pdf-pagina";
import type { PrestadorContext } from "../ingest/types";

const ALLOWED = new Set([".ofx", ".xlsx", ".xls", ".pdf"]);

export type PersistStorageFn = (
  relativePath: string,
  buffer: Buffer,
) => Promise<string>;

export type UploadFileInput = { filename: string; buffer: Buffer };

export type UploadErroItem = {
  nome: string;
  codigo: string;
  mensagem: string;
  causaTecnica: string;
};

export type UploadArquivoResult = {
  nome: string;
  movimentacoes_criadas: number;
  arquivo_id?: string;
  paginas?: number;
  modo?: "armazenar";
  linhas_ignoradas_sem_doc?: number;
};

export type UploadFilesResult = {
  arquivos: UploadArquivoResult[];
  erros: UploadErroItem[];
  total_movimentacoes: number;
};

export async function uploadFilesToSessao(
  db: Db,
  params: {
    sessaoId: string;
    diretorioEstadualId: string;
    uf: string;
    exercicio: number;
    prestador: PrestadorContext;
    files: UploadFileInput[];
    persistStorage: PersistStorageFn;
  },
): Promise<UploadFilesResult> {
  const { sessaoId, files, persistStorage, prestador } = params;
  const results: UploadArquivoResult[] = [];
  const errors: UploadErroItem[] = [];

  await db
    .update(sessaoPrestacao)
    .set({ status: SESSAO_STATUS.EM_PROCESSAMENTO })
    .where(eq(sessaoPrestacao.id, sessaoId));

  for (const file of files) {
    const suffix = path.extname(file.filename).toLowerCase();
    if (!ALLOWED.has(suffix)) {
      errors.push({
        nome: file.filename,
        codigo: "INGESTAO_DESCONHECIDA",
        mensagem: "Formato não suportado. Use PDF, Excel ou OFX.",
        causaTecnica: `Extensão não permitida: ${suffix || "(sem extensão)"}`,
      });
      continue;
    }

    const blobPath = `${params.uf}/${params.exercicio}/${sessaoId}/${randomUUID()}/${file.filename}`;
    let caminhoStorage: string;
    try {
      caminhoStorage = await persistStorage(blobPath, file.buffer);
    } catch (error) {
      const detail = classifyIngestError(
        error instanceof Error ? error : new Error("falha no storage"),
      );
      ingestLog("error", {
        fase: "storage",
        sessaoId,
        filename: file.filename,
        codigoErro: detail.codigo,
        causa: detail.causaTecnica,
      });
      errors.push({
        nome: file.filename,
        codigo: detail.codigo,
        mensagem: detail.mensagem,
        causaTecnica: detail.causaTecnica,
      });
      continue;
    }

    const prestadorCtx = {
      ...prestador,
      sessaoPrestacaoId: sessaoId,
    };

    try {
      if (suffix === ".pdf") {
        const stored = await armazenarPdfIngestBuffer(db, {
          diretorioId: params.diretorioEstadualId,
          uf: params.uf,
          exercicio: params.exercicio,
          filename: file.filename,
          buffer: file.buffer,
          caminhoStorage,
          sessaoPrestacaoId: sessaoId,
          prestador: prestadorCtx,
        });
        results.push({
          nome: file.filename,
          movimentacoes_criadas: 0,
          arquivo_id: stored.arquivoId,
          paginas: stored.pageCount,
          modo: "armazenar",
        });
        continue;
      }

      const result = await ingestFileBuffer(db, {
        diretorioId: params.diretorioEstadualId,
        uf: params.uf,
        exercicio: params.exercicio,
        filename: file.filename,
        buffer: file.buffer,
        caminhoStorage,
        sessaoPrestacaoId: sessaoId,
        prestador: prestadorCtx,
      });
      results.push({
        nome: file.filename,
        movimentacoes_criadas: result.movimentacoes_criadas,
        ...(result.linhas_ignoradas_sem_doc != null && result.linhas_ignoradas_sem_doc > 0
          ? { linhas_ignoradas_sem_doc: result.linhas_ignoradas_sem_doc }
          : {}),
      });
    } catch (error) {
      const detail = classifyIngestError(error);
      ingestLog("error", {
        fase: "persist",
        sessaoId,
        filename: file.filename,
        codigoErro: detail.codigo,
        causa: detail.causaTecnica,
      });
      errors.push({
        nome: file.filename,
        codigo: detail.codigo,
        mensagem: detail.mensagem,
        causaTecnica: detail.causaTecnica,
      });
    }
  }

  await db
    .update(sessaoPrestacao)
    .set({ status: SESSAO_STATUS.ABERTA, updatedAt: new Date() })
    .where(eq(sessaoPrestacao.id, sessaoId));

  const total_movimentacoes = results.reduce((s, r) => s + r.movimentacoes_criadas, 0);
  return { arquivos: results, erros: errors, total_movimentacoes };
}
```

Export from `packages/core/src/index.ts`:

```typescript
export {
  uploadFilesToSessao,
  type UploadFilesResult,
  type PersistStorageFn,
} from "./prestacao/upload-files";
```

- [ ] **Step 4: Refactor web upload route**

Replace inline loop in `apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts` with:

```typescript
import { uploadFilesToSessao } from "@spc-up/core";
// ...
const fileInputs = await Promise.all(
  files.map(async (file) => ({
    filename: file.name,
    buffer: Buffer.from(await file.arrayBuffer()),
  })),
);

const payload = await uploadFilesToSessao(db, {
  sessaoId,
  diretorioEstadualId: sessao.diretorioEstadualId,
  uf: sessao.uf,
  exercicio: sessao.exercicio,
  prestador: {
    cnpjPrestador: prestador.cnpjPrestador,
    tipoPrestador: prestador.tipoPrestador,
    sessaoPrestacaoId: sessaoId,
    diretorioMunicipalId: prestador.diretorioMunicipalId,
  },
  files: fileInputs,
  persistStorage: persistUpload,
});

if (payload.total_movimentacoes === 0 && payload.erros.length > 0) {
  return NextResponse.json(
    { error: "Nenhum arquivo foi processado com sucesso.", ...payload },
    { status: 422 },
  );
}
return NextResponse.json(payload);
```

Remove dead `modoArmazenar` branch — PDF always armazenar (wizard always sends PDF that way).

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @spc-up/core test upload-files.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/prestacao/upload-files.ts packages/core/src/prestacao/upload-files.test.ts packages/core/src/index.ts apps/web/app/api/prestacao/sessoes/\[id\]/upload/route.ts
git commit -m "feat(core): extract uploadFilesToSessao for web and CLI parity"
```

---

### Task 2: Core — `processSessaoPdfArquivos`

**Files:**
- Create: `packages/core/src/prestacao/process-sessao.ts`
- Create: `packages/core/src/prestacao/process-sessao.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, it, vi } from "vitest";

const processarPaginaMock = vi.fn();
const consolidateMock = vi.fn();

vi.mock("../ingest/pdf-pagina", () => ({
  processarPaginaPdfExtrato: (...args: unknown[]) => processarPaginaMock(...args),
}));

vi.mock("../consolidacao/run", () => ({
  consolidateSession: (...args: unknown[]) => consolidateMock(...args),
}));

vi.mock("./sessao", () => ({
  getSessao: vi.fn(async () => ({
    id: "sess-1",
    uf: "BA",
    exercicio: 2025,
    consolidarExtratos: true,
  })),
  prestadorFromSessao: vi.fn(() => ({
    cnpjPrestador: "23738595000182",
    tipoPrestador: "ESTADUAL",
  })),
}));

import { processSessaoPdfArquivos } from "./process-sessao";

describe("processSessaoPdfArquivos", () => {
  it("processes all pages of pending PDFs and runs consolidation", async () => {
    processarPaginaMock.mockResolvedValue({
      pagina: 1,
      totalPaginas: 1,
      movimentacoes_criadas: 5,
      statusPagina: "OK",
      modo: "texto",
    });
    consolidateMock.mockResolvedValue({ skipped: false, eventos: 2 });

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: "arq-1",
            nomeArquivo: "extrato.pdf",
            status: "PENDENTE",
          },
        ]),
      }),
    });

    const db = { select: selectMock } as never;

    const result = await processSessaoPdfArquivos(db, "sess-1");

    expect(processarPaginaMock).toHaveBeenCalled();
    expect(consolidateMock).toHaveBeenCalledWith(db, "sess-1");
    expect(result.consolidacao?.eventos).toBe(2);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @spc-up/core test process-sessao.test.ts`

- [ ] **Step 3: Implement**

`packages/core/src/prestacao/process-sessao.ts`:

```typescript
import { arquivoIngestao, type Db } from "@spc-up/db";
import { and, eq, inArray } from "drizzle-orm";

import { consolidateSession } from "../consolidacao/run";
import {
  processarPaginaPdfExtrato,
  type ProcessarPaginaPdfResult,
} from "../ingest/pdf-pagina";
import { ARQUIVO_INGESTAO_STATUS, type PrestadorContext } from "../ingest/types";
import { getSessao, prestadorFromSessao } from "./sessao";

export type ProcessPdfArquivoResult = {
  arquivoId: string;
  nome: string;
  paginas: ProcessarPaginaPdfResult[];
  erro?: string;
};

export type ProcessSessaoResult = {
  sessaoId: string;
  uf: string;
  exercicio: number;
  consolidarExtratos: boolean;
  arquivos: ProcessPdfArquivoResult[];
  movimentacoesTotal: number;
  paginasVerificar: number;
  consolidacao?:
    | { skipped: true; reason: string }
    | { skipped: false; eventos: number };
  avisos: string[];
};

async function listPendingPdfArquivos(db: Db, sessaoId: string) {
  const rows = await db
    .select()
    .from(arquivoIngestao)
    .where(
      and(
        eq(arquivoIngestao.sessaoPrestacaoId, sessaoId),
        inArray(arquivoIngestao.status, [
          ARQUIVO_INGESTAO_STATUS.PENDENTE,
          ARQUIVO_INGESTAO_STATUS.PROCESSANDO,
        ]),
      ),
    );
  return rows.filter((r) => /\.pdf$/i.test(r.nomeArquivo));
}

export async function processSessaoPdfArquivos(
  db: Db,
  sessaoId: string,
  options?: { skipConsolidacao?: boolean },
): Promise<ProcessSessaoResult> {
  const sessao = await getSessao(db, sessaoId);
  if (!sessao?.diretorioEstadual) {
    throw new Error("Sessão não encontrada ou sem diretório estadual");
  }

  const prestadorBase = prestadorFromSessao(sessao);
  const prestador: PrestadorContext = {
    cnpjPrestador: prestadorBase.cnpjPrestador,
    tipoPrestador: prestadorBase.tipoPrestador,
    sessaoPrestacaoId: sessaoId,
    diretorioMunicipalId: prestadorBase.diretorioMunicipalId,
  };

  const avisos: string[] = [];
  const arquivos: ProcessPdfArquivoResult[] = [];
  let movimentacoesTotal = 0;
  let paginasVerificar = 0;

  const pending = await listPendingPdfArquivos(db, sessaoId);
  if (pending.length === 0) {
    avisos.push("Nenhum PDF pendente de processamento.");
  }

  for (const arq of pending) {
    const paginas: ProcessarPaginaPdfResult[] = [];
    try {
      let pagina = 1;
      let totalPaginas = 1;
      while (pagina <= totalPaginas) {
        const pageRes = await processarPaginaPdfExtrato(
          db,
          arq.id,
          pagina,
          prestador,
        );
        paginas.push(pageRes);
        totalPaginas = pageRes.totalPaginas;
        movimentacoesTotal += pageRes.movimentacoes_criadas;
        if (pageRes.statusPagina === "VERIFICAR") {
          paginasVerificar += 1;
        }
        pagina += 1;
      }
      arquivos.push({ arquivoId: arq.id, nome: arq.nomeArquivo, paginas });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      arquivos.push({
        arquivoId: arq.id,
        nome: arq.nomeArquivo,
        paginas,
        erro: message,
      });
    }
  }

  let consolidacao: ProcessSessaoResult["consolidacao"];
  if (options?.skipConsolidacao) {
    consolidacao = { skipped: true, reason: "SKIP_FLAG" };
  } else {
    consolidacao = await consolidateSession(db, sessaoId);
  }

  return {
    sessaoId,
    uf: sessao.uf,
    exercicio: sessao.exercicio,
    consolidarExtratos: sessao.consolidarExtratos,
    arquivos,
    movimentacoesTotal,
    paginasVerificar,
    consolidacao,
    avisos,
  };
}
```

Export from `packages/core/src/index.ts`.

- [ ] **Step 4: Run tests — PASS**

Run: `pnpm --filter @spc-up/core test process-sessao.test.ts`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add processSessaoPdfArquivos for CLI PDF pipeline"
```

---

### Task 3: Core — `getPrestacaoCliStatus`

**Files:**
- Create: `packages/core/src/prestacao/cli-status.ts`
- Create: `packages/core/src/prestacao/cli-status.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Implement status aggregator**

`getPrestacaoCliStatus(db, sessaoId)` returns:

```typescript
export type PrestacaoCliStatus = {
  sessaoId: string;
  uf: string;
  exercicio: number;
  status: string;
  consolidarExtratos: boolean;
  arquivos: Array<{
    id: string;
    nome: string;
    status: string;
    movimentacoes: number;
  }>;
  movimentacoesTotal: number;
  movimentacoesPendentes: number;
  pdfPendentes: number;
  consolidacaoEventos: number;
  kanbanPath: string;
  consolidacaoPath: string;
};
```

Use `getSessao`, count `arquivoIngestao` by sessao, count movimentações with status != CONFIRMADO, `listConsolidacaoForSessao` for event count.

- [ ] **Step 2: Test with mocked db queries**

Run: `pnpm --filter @spc-up/core test cli-status.test.ts`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(core): add getPrestacaoCliStatus for CLI status command"
```

---

### Task 4: CLI libs — env, sessão, output, paths

**Files:**
- Create: `apps/cli/src/lib/load-env.ts`
- Create: `apps/cli/src/lib/sessao-context.ts`
- Create: `apps/cli/src/lib/format-output.ts`
- Create: `apps/cli/src/lib/resolve-path-files.ts`
- Create: `apps/cli/src/lib/load-env.test.ts`

- [ ] **Step 1: `load-env.ts`**

```typescript
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function loadEnvFile(explicitPath?: string): void {
  const candidates = [
    explicitPath,
    path.join(homedir(), ".spc-up", ".env"),
    path.join(process.cwd(), ".env"),
  ].filter(Boolean) as string[];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq);
      if (process.env[key] == null) {
        process.env[key] = trimmed.slice(eq + 1);
      }
    }
    return;
  }
}
```

- [ ] **Step 2: `sessao-context.ts`**

```typescript
import { getSessao, prestadorFromSessao } from "@spc-up/core";
import type { Db } from "@spc-up/db";

export async function requireSessaoContext(db: Db, sessaoId: string) {
  const sessao = await getSessao(db, sessaoId);
  if (!sessao?.diretorioEstadualId || !sessao.diretorioEstadual) {
    throw new Error(`Sessão não encontrada: ${sessaoId}`);
  }
  const prestador = prestadorFromSessao(sessao);
  return { sessao, prestador };
}
```

- [ ] **Step 3: `resolve-path-files.ts`**

Reuse `resolveIngestPaths` from core + `readFile` each path → `{ filename, buffer }[]`.

- [ ] **Step 4: `format-output.ts`**

```typescript
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function kanbanUrl(sessaoId: string): string {
  const base = process.env.AUTH_URL?.replace(/\/$/, "");
  const path = `/prestacao/${sessaoId}/kanban`;
  return base ? `${base}${path}` : path;
}
```

- [ ] **Step 5: Test load-env**

Run: `pnpm --filter @spc-up/cli test load-env.test.ts`

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(cli): add env, sessao context, and output helpers"
```

---

### Task 5: CLI — `cadastro import`

**Files:**
- Create: `apps/cli/src/commands/cadastro-import.ts`
- Create: `apps/cli/src/commands/cadastro-import.test.ts`
- Modify: `apps/cli/src/main.ts`

- [ ] **Step 1: Handler**

```typescript
import { importCadastroBatch, parseCadastroSpreadsheet } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { readFile } from "node:fs/promises";

export async function runCadastroImport(opts: {
  uf: string;
  exercicio: string;
  file: string;
  dryRun?: boolean;
  json?: boolean;
}): Promise<void> {
  const exercicio = Number.parseInt(opts.exercicio, 10);
  if (Number.isNaN(exercicio)) throw new Error("--exercicio must be a number");

  const buffer = await readFile(opts.file);
  const parsed = await parseCadastroSpreadsheet(
    buffer,
    path.basename(opts.file),
  );

  if (opts.dryRun) {
    const summary = {
      linhas_ok: parsed.ok.length,
      erros: parsed.erros,
    };
    if (opts.json) printJson(summary);
    else console.log(`Dry-run: ${parsed.ok.length} linha(s) válida(s), ${parsed.erros.length} erro(s).`);
    return;
  }

  const db = getDb();
  const result = await importCadastroBatch(
    db,
    parsed.ok,
    opts.uf.toUpperCase(),
    exercicio,
  );
  const payload = { ...result, erros: [...parsed.erros, ...result.erros] };

  if (opts.json) printJson(payload);
  else {
    console.log(
      `Importação: ${result.inseridos} inseridos, ${result.atualizados} atualizados, ${result.conflitos} conflitos.`,
    );
    for (const e of payload.erros) console.error(`  ERRO linha ${e.linha}: ${e.mensagem}`);
  }
}
```

- [ ] **Step 2: Register in main.ts**

```typescript
program
  .command("cadastro")
  .command("import")
  .requiredOption("--uf <uf>", "UF")
  .requiredOption("--exercicio <year>", "Exercício")
  .requiredOption("--file <path>", "Planilha xlsx/csv")
  .option("--dry-run", "Parse only")
  .option("--json", "JSON output")
  .option("--env-file <path>", "Env file")
  .action(async (opts) => {
    loadEnvFile(opts.envFile);
    await runCadastroImport(opts);
  });
```

Note: Commander nested groups — use `program.command('cadastro').addCommand(importCmd)` pattern if needed.

- [ ] **Step 3: Test dry-run with fixture**

Use `packages/core/fixtures/cadastro-sample.xlsx`.

Run: `pnpm --filter @spc-up/cli test cadastro-import.test.ts`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cli): add cadastro import command"
```

---

### Task 6: CLI — `prestacao upload`

**Files:**
- Create: `apps/cli/src/commands/prestacao-upload.ts`
- Modify: `apps/cli/src/main.ts`

- [ ] **Step 1: Handler**

```typescript
import { storeIngestBuffer, uploadFilesToSessao } from "@spc-up/core";
import { getDb } from "@spc-up/db";

export async function runPrestacaoUpload(opts: {
  sessao: string;
  path: string;
  json?: boolean;
}): Promise<void> {
  const db = getDb();
  const { sessao, prestador } = await requireSessaoContext(db, opts.sessao);
  const files = await resolvePathToFileBuffers(opts.path);

  const result = await uploadFilesToSessao(db, {
    sessaoId: sessao.id,
    diretorioEstadualId: sessao.diretorioEstadualId!,
    uf: sessao.uf,
    exercicio: sessao.exercicio,
    prestador: {
      cnpjPrestador: prestador.cnpjPrestador,
      tipoPrestador: prestador.tipoPrestador,
      sessaoPrestacaoId: sessao.id,
      diretorioMunicipalId: prestador.diretorioMunicipalId,
    },
    files,
    persistStorage: storeIngestBuffer,
  });

  if (result.total_movimentacoes === 0 && result.erros.length > 0) {
    process.exitCode = 1;
  }

  if (opts.json) printJson(result);
  else {
    for (const a of result.arquivos) {
      console.log(`${a.nome}: ${a.movimentacoes_criadas} mov(s)${a.paginas ? `, ${a.paginas} pág. PDF armazenado` : ""}`);
    }
    for (const e of result.erros) console.error(`${e.nome}: ${e.mensagem}`);
  }
}
```

- [ ] **Step 2: Register command + global `--env-file`**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(cli): add prestacao upload command"
```

---

### Task 7: CLI — `prestacao process` + `run` + `status`

**Files:**
- Create: `apps/cli/src/commands/prestacao-process.ts`
- Create: `apps/cli/src/commands/prestacao-run.ts`
- Create: `apps/cli/src/commands/prestacao-status.ts`
- Modify: `apps/cli/src/main.ts`

- [ ] **Step 1: `prestacao process`**

Calls `processSessaoPdfArquivos`. Human output per spec §4.4. Print `kanbanUrl(sessaoId)` at end.

```typescript
export async function runPrestacaoProcess(opts: {
  sessao: string;
  skipConsolidacao?: boolean;
  json?: boolean;
}): Promise<void> {
  const db = getDb();
  const result = await processSessaoPdfArquivos(db, opts.sessao, {
    skipConsolidacao: opts.skipConsolidacao,
  });

  if (opts.json) {
    printJson(result);
    return;
  }

  console.log(
    `Sessão: ${result.sessaoId}  UF=${result.uf}  exercício=${result.exercicio}  consolidarExtratos=${result.consolidarExtratos}`,
  );
  for (const arq of result.arquivos) {
    console.log(`\nPDF ${arq.nome}`);
    for (const p of arq.paginas) {
      console.log(
        `  p.${p.pagina} ${p.statusPagina} — ${p.movimentacoes_criadas} movimentação(ões)`,
      );
    }
    if (arq.erro) console.error(`  ERRO — ${arq.erro}`);
  }
  if (result.consolidacao?.skipped === false) {
    console.log(`\nConsolidação: ${result.consolidacao.eventos} evento(s) gerados`);
  } else if (result.consolidacao?.skipped) {
    console.log(`\nConsolidação: ignorada (${result.consolidacao.reason})`);
  }
  console.log(`\nPróximo passo: ${kanbanUrl(result.sessaoId)}`);
}
```

- [ ] **Step 2: `prestacao run`**

```typescript
export async function runPrestacaoRun(opts: {
  sessao: string;
  path: string;
  skipConsolidacao?: boolean;
  json?: boolean;
}): Promise<void> {
  await runPrestacaoUpload({ sessao: opts.sessao, path: opts.path, json: opts.json });
  if (process.exitCode === 1) return;
  await runPrestacaoProcess({
    sessao: opts.sessao,
    skipConsolidacao: opts.skipConsolidacao,
    json: opts.json,
  });
}
```

- [ ] **Step 3: `prestacao status`**

Calls `getPrestacaoCliStatus`; supports `--json`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cli): add prestacao process, run, and status commands"
```

---

### Task 8: CLI — deprecação legado + help

**Files:**
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/commands/ingest.ts`

- [ ] **Step 1: Add deprecation warning to `ingest`**

At start of `runIngest`:

```typescript
console.error(
  "[deprecated] Use: spc-up prestacao upload --sessao <uuid> --path ./lote/",
);
```

- [ ] **Step 2: Update root help description**

```typescript
program
  .description(
    "SPC UP — prestação de contas\n\nFluxo oficial: web cria sessão → spc-up prestacao run --sessao <id> --path ./lote/",
  );
```

- [ ] **Step 3: Integration test — help lists new commands**

Add to `apps/cli/src/cli.integration.test.ts`:

```typescript
expect(help).toContain("cadastro");
expect(help).toContain("prestacao");
```

Run: `pnpm --filter @spc-up/cli test`

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(cli): deprecate legacy ingest and update help"
```

---

### Task 9: Instalação facilitada (Fase 1)

**Files:**
- Create: `scripts/install-spc-up.sh`
- Create: `scripts/install-spc-up.ps1`
- Create: `scripts/spc-up.env.example`
- Create: `apps/cli/README.md`
- Modify: `apps/cli/package.json`

- [ ] **Step 1: Publish-ready `package.json`**

Add to `apps/cli/package.json`:

```json
{
  "files": ["dist", "README.md"],
  "engines": { "node": ">=20" },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "restricted"
  },
  "scripts": {
    "prepublishOnly": "pnpm run build"
  }
}
```

- [ ] **Step 2: `scripts/install-spc-up.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
need_node=20
node_major=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$node_major" -lt "$need_node" ]; then
  echo "Node $need_node+ required (found: $(node -v 2>/dev/null || echo none))" >&2
  exit 1
fi
npm install -g @spc-up/cli
mkdir -p "$HOME/.spc-up"
if [ ! -f "$HOME/.spc-up/.env" ]; then
  cp "$(dirname "$0")/spc-up.env.example" "$HOME/.spc-up/.env"
  echo "Created ~/.spc-up/.env — edit DATABASE_URL and OPENROUTER_API_KEY"
fi
spc-up --version
```

- [ ] **Step 3: `scripts/install-spc-up.ps1`** — equivalent PowerShell with `npm install -g @spc-up/cli`

- [ ] **Step 4: `scripts/spc-up.env.example`** — copy keys from root `.env.example` (DATABASE_URL, OPENROUTER_*, STORAGE_ROOT)

- [ ] **Step 5: `apps/cli/README.md`** — install + fluxo completo

- [ ] **Step 6: CI smoke — build CLI tarball**

Add job step to `.github/workflows/ci.yml`:

```yaml
- name: CLI package smoke
  run: |
    pnpm --filter @spc-up/cli build
    node apps/cli/dist/main.js --help | grep prestacao
    npm pack --workspace @spc-up/cli
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(cli): add install scripts and publish package config"
```

---

### Task 10: Documentação

**Files:**
- Modify: `README.md`
- Modify: `docs/piloto-checklist.md`
- Modify: `docs/superpowers/specs/2026-05-28-cli-prestacao-import-process-design.md` (status → Aprovado)
- Modify: `docs/superpowers/specs/2026-05-26-cadastro-pf-pj-design.md` (nota supersessão CLI)

- [ ] **Step 1: README § CLI**

Replace current CLI section with:

```markdown
## CLI (importação e processamento)

Instalação: `./scripts/install-spc-up.sh` ou `npm i -g @spc-up/cli`

1. Criar sessão em `/prestacao/nova` (web)
2. `spc-up cadastro import --uf BA --exercicio 2025 --file pessoas.xlsx`
3. `spc-up prestacao run --sessao <uuid> --path ./lote/`
4. Revisar kanban e exportar na web
```

- [ ] **Step 2: Piloto checklist** — insert CLI steps between session create and kanban review

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: CLI sessão flow and install instructions"
```

---

### Task 11: Verificação final

- [ ] **Step 1: Full test suite**

Run: `pnpm test && pnpm build`
Expected: all green

- [ ] **Step 2: Manual smoke (local)**

```bash
pnpm --filter @spc-up/cli build
pnpm spc-up cadastro import --help
pnpm spc-up prestacao run --help
```

- [ ] **Step 3: Verify acceptance criteria from spec §12**

| # | Check |
|---|-------|
| 1 | CLI install script + `prestacao run --sessao` without monorepo clone |
| 2 | Movimentações visíveis no kanban após CLI process |
| 3 | `cadastro import` contadores = web import |
| 4 | Consolidação eventos após 2+ PDFs |
| 5 | CI `prestacao status --json` exit 0 |

---

## Plan self-review

**Spec coverage:**

| Spec requirement | Task |
|------------------|------|
| `cadastro import` | Task 5 |
| `prestacao upload/process/run/status` | Tasks 6–7 |
| `--sessao`, `--env-file`, `--json` | Tasks 4, 6–7 |
| Consolidação automática | Task 2 |
| Helper upload API+CLI | Task 1 |
| Instalação mac/linux/win/CI | Task 9 |
| Deprecação legado | Task 8 |
| Docs | Task 10 |
| Critérios aceite | Task 11 |

**Out of scope (correct):** kanban, export ZIP, aprovar consolidação, criar sessão CLI, binário standalone Fase 2.

**No placeholders:** all tasks have concrete files and code snippets.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-cli-prestacao-import-process.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — implement tasks in this session with checkpoints

Which approach do you want?
