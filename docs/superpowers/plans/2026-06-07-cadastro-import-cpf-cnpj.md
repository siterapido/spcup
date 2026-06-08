# Importação cadastro CPF/CNPJ — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importação de pessoas tolera máscara, zeros à esquerda perdidos no Excel e decimais `.0`/`,00`, inferindo PF/PJ pelo tamanho do documento limpo.

**Architecture:** Função `prepareDocumentoRaw` centraliza limpeza e pad antes de `normalizeCpf`/`normalizeCnpj`. `parseRow`, `cellToText`, `inferTipoFromDocumento` e `cellLooksLikeDocument` delegam a ela. Aliases de cabeçalho ampliados. Sem mudança de API web.

**Tech Stack:** TypeScript, Vitest, ExcelJS (`packages/core`), Next.js import existente.

**Spec:** [2026-06-07-cadastro-import-cpf-cnpj-design.md](../specs/2026-06-07-cadastro-import-cpf-cnpj-design.md)

---

## Arquivos

| Arquivo | Ação |
|---------|------|
| `packages/core/src/cadastro/parse.ts` | Modificar — `prepareDocumentoRaw`, ajustes em `cellToText`, `inferTipoFromDocumento`, `parseRow`, aliases |
| `packages/core/src/cadastro/parse.test.ts` | Modificar — novos casos |
| `packages/core/src/cadastro/index.ts` | Modificar — exportar `prepareDocumentoRaw` se testes precisarem (opcional) |

---

### Task 1: `prepareDocumentoRaw` com testes

**Files:**
- Modify: `packages/core/src/cadastro/parse.ts`
- Test: `packages/core/src/cadastro/parse.test.ts`

- [ ] **Step 1: Escrever testes falhando para `prepareDocumentoRaw`**

Adicionar em `parse.test.ts`:

```typescript
import { prepareDocumentoRaw } from "./parse";

describe("prepareDocumentoRaw", () => {
  it("pads short CPF to 11 digits", () => {
    const r = prepareDocumentoRaw("12345678909");
    expect(r.tipo).toBe("PF");
    expect(r.documento).toBe("12345678909");
  });

  it("strips mask from CPF", () => {
    const r = prepareDocumentoRaw("123.456.789-09");
    expect(r.tipo).toBe("PF");
    expect(r.documento).toBe("12345678909");
  });

  it("pads numeric CPF missing leading zeros", () => {
    const r = prepareDocumentoRaw("34567890");
    expect(r.tipo).toBe("PF");
    expect(r.documento).toBe("0034567890");
  });

  it("strips decimal suffix from string document", () => {
    const r = prepareDocumentoRaw("11222333000181.0");
    expect(r.tipo).toBe("PJ");
    expect(r.documento).toBe("11222333000181");
  });

  it("infers PJ for 14-char cleaned doc", () => {
    const r = prepareDocumentoRaw("11.222.333/0001-81");
    expect(r.tipo).toBe("PJ");
    expect(r.documento).toBe("11222333000181");
  });

  it("respects explicit tipo PF", () => {
    const r = prepareDocumentoRaw("12345678909", "PF");
    expect(r.tipo).toBe("PF");
    expect(r.documento).toBe("12345678909");
  });

  it("throws on empty document", () => {
    expect(() => prepareDocumentoRaw("")).toThrow(/vazio/i);
  });
});
```

- [ ] **Step 2: Rodar testes — devem falhar**

```bash
cd packages/core && pnpm exec vitest run src/cadastro/parse.test.ts -t prepareDocumentoRaw
```

Expected: FAIL — `prepareDocumentoRaw` not exported / not defined

- [ ] **Step 3: Implementar `prepareDocumentoRaw` em `parse.ts`**

```typescript
export function prepareDocumentoRaw(
  raw: string,
  explicitTipo?: "PF" | "PJ",
): { tipo: "PF" | "PJ"; documento: string } {
  let text = cellToText(raw).replace(/\s+/g, "");
  if (/^[0-9]+[,.]0+$/.test(text)) {
    text = text.replace(/[,.]0+$/, "");
  }
  let clean = text.replace(/[^A-Za-z0-9]/g, "");
  if (!clean) {
    throw new Error("Documento vazio");
  }

  let tipo = explicitTipo ?? null;
  if (tipo == null) {
    if (clean.length <= 11) tipo = "PF";
    else if (clean.length <= 14) tipo = "PJ";
    else throw new Error("Documento com tamanho inválido");
  }

  if (tipo === "PF") {
    clean = clean.replace(/\D/g, "");
    if (clean.length > 11) {
      throw new Error("Documento com tamanho inválido");
    }
    clean = clean.padStart(11, "0");
  } else {
    clean = clean.toUpperCase();
    if (clean.length > 14) {
      throw new Error("Documento com tamanho inválido");
    }
    clean = clean.padStart(14, "0");
  }

  return { tipo, documento: clean };
}
```

- [ ] **Step 4: Rodar testes — devem passar**

```bash
cd packages/core && pnpm exec vitest run src/cadastro/parse.test.ts -t prepareDocumentoRaw
```

Expected: PASS

---

### Task 2: Integrar em `parseRow` e `inferTipoFromDocumento`

**Files:**
- Modify: `packages/core/src/cadastro/parse.ts`
- Test: `packages/core/src/cadastro/parse.test.ts`

- [ ] **Step 1: Teste de integração — CPF numérico curto na planilha**

```typescript
it("parses xlsx with short numeric CPF cell", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Pessoas");
  sheet.addRow(["nome", "documento"]);
  sheet.addRow(["Maria Souza", 34567890]);
  const buf = Buffer.from(await workbook.xlsx.writeBuffer());

  const result = await parseCadastroSpreadsheet(buf, "cpf-curto.xlsx", {
    documento: "documento",
    nome: "nome",
  });
  expect(result.ok).toHaveLength(1);
  expect(result.ok[0]?.tipo).toBe("PF");
  expect(result.ok[0]?.documento).toHaveLength(11);
});
```

Ajustar CPF no teste para um com dígitos verificadores válidos (usar CPF de fixture existente `12345678909` truncado ou número que após pad valide).

- [ ] **Step 2: Rodar teste — deve falhar**

```bash
cd packages/core && pnpm exec vitest run src/cadastro/parse.test.ts -t "short numeric CPF"
```

- [ ] **Step 3: Refatorar `parseRow`**

Substituir bloco de `documentoRaw` + `inferTipoFromDocumento` + `normalizeDocumento` por:

```typescript
const documentoRaw = cellToText(record.documento);
const nomeRaw = cellToText(record.nome);
// ... validações vazio ...

let tipo = tipoRaw ? parseCadastroTipo(tipoRaw) : null;
if (tipoRaw && tipo == null) {
  return { erro: `Tipo inválido: ${tipoRaw}` };
}

try {
  const prepared = prepareDocumentoRaw(documentoRaw, tipo ?? undefined);
  tipo = prepared.tipo;
  const documento = normalizeDocumento(tipo, prepared.documento);
  const nome = normalizeName(nomeRaw);
  return { ok: { linha, tipo, documento, nome } };
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  return { erro: message };
}
```

Remover ou simplificar `inferTipoFromDocumento` se só usado em `parseRow`; manter export se `cellLooksLikeDocument` ainda precisar.

- [ ] **Step 4: Atualizar `inferTipoFromDocumento`**

```typescript
function inferTipoFromDocumento(documentoRaw: string): "PF" | "PJ" | null {
  try {
    return prepareDocumentoRaw(documentoRaw).tipo;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Rodar suite cadastro parse**

```bash
cd packages/core && pnpm exec vitest run src/cadastro/parse.test.ts
```

Expected: PASS (corrigir fixture CPF se DV inválido)

---

### Task 3: Melhorar `cellToText` e `cellLooksLikeDocument`

**Files:**
- Modify: `packages/core/src/cadastro/parse.ts`
- Test: `packages/core/src/cadastro/parse.test.ts`

- [ ] **Step 1: Testes para string com decimal**

```typescript
it("strips trailing decimal from document string", () => {
  expect(cellToText("12345678909.0")).toBe("12345678909");
  expect(cellToText("11222333000181,00")).toBe("11222333000181");
});
```

- [ ] **Step 2: Implementar em `cellToText`**

No final do branch `String(value).trim()`, antes do return:

```typescript
let s = String(value).trim();
if (/^[0-9]+[,.]0+$/.test(s)) {
  s = s.replace(/[,.]0+$/, "");
}
return s;
```

- [ ] **Step 3: Relaxar `cellLooksLikeDocument`**

Usar `prepareDocumentoRaw` em try/catch; se não lançar e `normalizeCpf`/`normalizeCnpj` passar, retornar true.

- [ ] **Step 4: Rodar testes**

```bash
cd packages/core && pnpm exec vitest run src/cadastro/parse.test.ts
```

---

### Task 4: Aliases de cabeçalho

**Files:**
- Modify: `packages/core/src/cadastro/parse.ts`
- Test: `packages/core/src/cadastro/parse.test.ts`

- [ ] **Step 1: Teste de alias**

```typescript
it("maps CPF.CNPJ header to documento", () => {
  expect(suggestCadastroColumnMap(["CPF.CNPJ", "Nome"])).toMatchObject({
    documento: "CPF.CNPJ",
    nome: "Nome",
  });
});
```

- [ ] **Step 2: Adicionar aliases em `HEADER_ALIASES`**

```typescript
cpf_cnpj: "documento",
n_documento: "documento",
no_documento: "documento",
num_documento: "documento",
```

(`normalizeHeaderKey` já converte `Nº Documento` → `n_documento`)

- [ ] **Step 3: Rodar testes**

```bash
cd packages/core && pnpm exec vitest run src/cadastro/parse.test.ts
```

---

### Task 5: Verificação final

- [ ] **Rodar pacote core inteiro**

```bash
cd packages/core && pnpm test
```

Expected: all pass

- [ ] **Smoke manual (opcional):** subir web, `/pessoas/importar`, planilha com CPF numérico sem zeros — preview mapeia, import sem erro de dígitos.

---

## Self-review (spec × plano)

| Requisito spec | Task |
|----------------|------|
| Pad CPF ≤11 | Task 1, 2 |
| Pad CNPJ ≤14 | Task 1, 2 |
| Strip máscara | Task 1 |
| Decimais `.0`/`,00` | Task 1, 3 |
| Inferência PF/PJ | Task 1, 2 |
| Aliases cabeçalho | Task 4 |
| Erros por linha | Task 2 (try/catch parseRow) |
| Testes | Tasks 1–4 |
| Fora de escopo UI | Nenhuma task UI ✓ |
