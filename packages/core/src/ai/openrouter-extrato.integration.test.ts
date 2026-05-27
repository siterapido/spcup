import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  extractTransactionsFromPdfFile,
  resolveExtratoModel,
} from "./openrouter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PDF_DIR = path.join(REPO_ROOT, "Documentos para teste ");

const BAHIA_PDFS = [
  "Extrato Jan PIX (1).pdf",
  "EXTRATO TOTAL JANEIRO (1) (1).pdf",
] as const;

const GEMINI_MODEL = "google/gemini-3.5-flash";
const KIMI_MODEL = "moonshotai/kimi-k2.6";
const MISTRAL_OCR_PLUGIN = [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }];

const runIntegration =
  process.env.SPC_OPENROUTER_INTEGRATION === "1" &&
  Boolean(process.env.OPENROUTER_API_KEY?.trim());

function fetchWithPluginAudit(realFetch: typeof fetch): {
  fetch: typeof fetch;
  pluginsPerCall: Array<unknown>;
  callCount: () => number;
} {
  let calls = 0;
  const pluginsPerCall: Array<unknown> = [];
  const auditedFetch: typeof fetch = async (input, init) => {
    calls += 1;
    if (init?.body && typeof init.body === "string") {
      const body = JSON.parse(init.body) as { plugins?: unknown };
      pluginsPerCall.push(body.plugins);
    }
    return realFetch(input, init);
  };
  return { fetch: auditedFetch, pluginsPerCall, callCount: () => calls };
}

function restoreEnv(key: string, prev: string | undefined) {
  if (prev === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = prev;
  }
}

describe.runIf(runIntegration)("Gemini extrato (integration)", () => {
  const prevCache = process.env.OPENROUTER_CACHE;
  const prevPdfModel = process.env.OPENROUTER_PDF_MODEL;

  afterEach(() => {
    restoreEnv("OPENROUTER_CACHE", prevCache);
    restoreEnv("OPENROUTER_PDF_MODEL", prevPdfModel);
  });

  it("defaults extrato model to Gemini when OPENROUTER_PDF_MODEL unset", () => {
    delete process.env.OPENROUTER_PDF_MODEL;
    process.env.OPENROUTER_MODEL = KIMI_MODEL;
    expect(resolveExtratoModel()).toBe(GEMINI_MODEL);
  });

  it.each(BAHIA_PDFS)(
    "extracts transactions from %s without mistral-ocr",
    async (filename) => {
      process.env.OPENROUTER_CACHE = "0";
      const buffer = await readFile(path.join(PDF_DIR, filename));
      const { fetch: auditedFetch, pluginsPerCall, callCount } = fetchWithPluginAudit(fetch);

      const result = await extractTransactionsFromPdfFile(buffer, {
        filename,
        model: GEMINI_MODEL,
        fetch: auditedFetch,
        timeoutMs: 180_000,
      });

      const visionCalls = pluginsPerCall.filter((plugins) => plugins != null);
      expect(visionCalls).toHaveLength(0);

      expect(result.transacoes.length).toBeGreaterThan(0);

      if (filename.includes("PIX")) {
        expect(result.transacoes.length).toBeGreaterThanOrEqual(30);
        const withNome = result.transacoes.filter((t) => String(t.nome ?? "").trim()).length;
        expect(withNome).toBeGreaterThanOrEqual(Math.floor(result.transacoes.length * 0.9));
        expect(callCount()).toBe(1);
      }

      if (filename.includes("TOTAL")) {
        // Layout crédito/débito genérico: modelo costuma retornar só códigos em descricao (ex. CRED TEV).
        expect(result.transacoes.length).toBeGreaterThanOrEqual(25);
        expect(callCount()).toBe(1);
      }

      const sample = result.transacoes[0]!;
      expect(sample.data).toBeTruthy();
      expect(sample.valor).toBeDefined();
      expect(["ENTRADA", "SAIDA"]).toContain(String(sample.direcao).toUpperCase());
    },
    600_000,
  );
});

describe.runIf(runIntegration && process.env.SPC_TEST_KIMI === "1")(
  "Kimi extrato + mistral-ocr (integration)",
  () => {
    const prevCache = process.env.OPENROUTER_CACHE;
    const prevPdfModel = process.env.OPENROUTER_PDF_MODEL;

    afterEach(() => {
      restoreEnv("OPENROUTER_CACHE", prevCache);
      restoreEnv("OPENROUTER_PDF_MODEL", prevPdfModel);
    });

    it.each(BAHIA_PDFS)(
      "extracts transactions from %s with mistral-ocr on every OpenRouter call",
      async (filename) => {
        process.env.OPENROUTER_CACHE = "0";
        const buffer = await readFile(path.join(PDF_DIR, filename));
        const { fetch: auditedFetch, pluginsPerCall } = fetchWithPluginAudit(fetch);

        const result = await extractTransactionsFromPdfFile(buffer, {
          filename,
          model: KIMI_MODEL,
          fetch: auditedFetch,
          timeoutMs: 180_000,
        });

        const visionCalls = pluginsPerCall.filter((plugins) => plugins != null);
        expect(visionCalls.length).toBeGreaterThan(0);
        for (const plugins of visionCalls) {
          expect(plugins).toEqual(MISTRAL_OCR_PLUGIN);
        }

        expect(result.transacoes.length).toBeGreaterThan(0);

        const sample = result.transacoes[0]!;
        expect(sample.data).toBeTruthy();
        expect(sample.valor).toBeDefined();
        expect(["ENTRADA", "SAIDA"]).toContain(String(sample.direcao).toUpperCase());
      },
      600_000,
    );
  },
);
