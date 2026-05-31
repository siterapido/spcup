/**
 * E2E via mesmas APIs da web (wizard UI + este script = fluxo completo).
 * Uso: pnpm exec tsx scripts/web-e2e-prestacao.ts
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { loadEnvFile } from "../apps/cli/src/lib/load-env";

loadEnvFile();

function envUrl(key: string, fallback: string): string {
  const raw = process.env[key]?.trim().replace(/^["']|["']$/g, "") ?? "";
  return (raw || fallback).replace(/\/$/, "");
}

const useProd = process.argv.includes("--prod");
const BASE = useProd
  ? envUrl("AUTH_URL", "https://spcup.vercel.app")
  : "http://localhost:3000";
const DOC_DIR = path.join(process.cwd(), "Documentos para teste ");
const PDFS = ["Extrato Jan PIX (1).pdf", "EXTRATO TOTAL JANEIRO (1) (1).pdf"];

function loadAdminCreds() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error("ADMIN_EMAIL e ADMIN_PASSWORD obrigatórios");
  }
  return { email, password };
}

class CookieJar {
  private map = new Map<string, string>();

  ingest(headers: Headers) {
    const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
    const list =
      typeof anyHeaders.getSetCookie === "function"
        ? anyHeaders.getSetCookie()
        : headers.get("set-cookie")
          ? [headers.get("set-cookie")!]
          : [];
    for (const raw of list) {
      const part = raw.split(";")[0]?.trim();
      if (!part) continue;
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      this.map.set(part.slice(0, eq), part.slice(eq + 1));
    }
  }

  header(): string | undefined {
    if (this.map.size === 0) return undefined;
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function signIn(): Promise<CookieJar> {
  const { email, password } = loadAdminCreds();
  const jar = new CookieJar();

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, {
    headers: jar.header() ? { cookie: jar.header()! } : undefined,
  });
  jar.ingest(csrfRes.headers);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      cookie: jar.header()!,
    },
    body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
    redirect: "manual",
  });
  jar.ingest(loginRes.headers);

  if (loginRes.status !== 200 && loginRes.status !== 302) {
    const text = await loginRes.text();
    throw new Error(`Login falhou HTTP ${loginRes.status}: ${text.slice(0, 200)}`);
  }

  const sessionRes = await fetch(`${BASE}/api/auth/session`, {
    headers: { cookie: jar.header()! },
  });
  jar.ingest(sessionRes.headers);
  const session = (await sessionRes.json()) as { user?: { email?: string } };
  if (!session.user?.email) {
    throw new Error("Sessão Auth.js não estabelecida após login");
  }
  return jar;
}

async function api(jar: CookieJar, pathname: string, init?: RequestInit): Promise<Response> {
  const cookie = jar.header();
  return fetch(`${BASE}${pathname}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(cookie ? { cookie } : {}),
    },
  });
}

async function main() {
  console.log(`Base: ${BASE}`);
  const jar = await signIn();
  console.log("Login OK");

  const sessRes = await api(jar, "/api/prestacao/sessoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uf: "BA",
      tipoPrestador: "ESTADUAL",
      exercicio: 2025,
      consolidarExtratos: true,
    }),
  });
  const sessJson = (await sessRes.json()) as { id?: string; error?: string };
  if (!sessRes.ok || !sessJson.id) {
    throw new Error(sessJson.error ?? `Criar sessão HTTP ${sessRes.status}`);
  }
  const sessaoId = sessJson.id;
  console.log(`Sessão: ${sessaoId}`);

  const pdfJobs: Array<{ nome: string; arquivoId: string; paginas: number }> = [];

  for (const nome of PDFS) {
    const buf = readFileSync(path.join(DOC_DIR, nome));
    const fd = new FormData();
    fd.append("files", new Blob([buf], { type: "application/pdf" }), nome);
    fd.append("modo", "armazenar");

    const upRes = await api(jar, `/api/prestacao/sessoes/${sessaoId}/upload`, {
      method: "POST",
      body: fd,
    });
    const upJson = (await upRes.json()) as {
      arquivos?: Array<{
        nome: string;
        arquivo_id?: string;
        paginas?: number;
      }>;
      erros?: unknown[];
      error?: string;
    };
    if (!upRes.ok) {
      throw new Error(upJson.error ?? `Upload ${nome} HTTP ${upRes.status}`);
    }
    const st = upJson.arquivos?.[0];
    if (st?.arquivo_id && st.paginas) {
      pdfJobs.push({ nome: st.nome, arquivoId: st.arquivo_id, paginas: st.paginas });
      console.log(`Upload ${nome}: ${st.paginas} pág(s)`);
    }
  }

  let movTotal = 0;
  for (const job of pdfJobs) {
    for (let pagina = 1; pagina <= job.paginas; pagina += 1) {
      process.stdout.write(`Processando ${job.nome} p.${pagina}/${job.paginas}… `);
      const pr = await api(
        jar,
        `/api/prestacao/sessoes/${sessaoId}/arquivos/${job.arquivoId}/paginas/${pagina}/processar`,
        { method: "POST" },
      );
      const pj = (await pr.json()) as {
        movimentacoes_criadas?: number;
        statusPagina?: string;
        error?: string;
      };
      if (!pr.ok) {
        console.log(`ERRO ${pj.error ?? pr.status}`);
      } else {
        const n = pj.movimentacoes_criadas ?? 0;
        movTotal += n;
        console.log(`${n} mov (${pj.statusPagina ?? "?"})`);
      }
    }
  }

  if (pdfJobs.length >= 2) {
    console.log("Consolidação…");
    const cr = await api(jar, `/api/prestacao/sessoes/${sessaoId}/consolidacao/run`, {
      method: "POST",
    });
    const cj = (await cr.json()) as { eventos?: number; skipped?: boolean; reason?: string };
    console.log(cr.ok ? `Consolidação: ${JSON.stringify(cj)}` : `Consolidação HTTP ${cr.status}`);
  }

  const kanban = `${BASE}/prestacao/${sessaoId}/kanban`;
  const consolidacao = `${BASE}/prestacao/${sessaoId}/consolidacao`;
  console.log(`\nMovimentações (esta rodada): ~${movTotal}`);
  console.log(`Kanban: ${kanban}`);
  if (pdfJobs.length >= 2) console.log(`Consolidação: ${consolidacao}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
