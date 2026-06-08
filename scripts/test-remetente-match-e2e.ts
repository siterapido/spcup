/**
 * E2E: mapeamento remetente_destinatario + match cadastro.
 * Run: pnpm exec tsx scripts/test-remetente-match-e2e.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  applyDeterministicMatch,
  compararNomeCadastro,
  createSessao,
  getSessao,
  importCadastroBatch,
  listPlanilhaForSessao,
  parseCadastroSpreadsheet,
  prestadorFromSessao,
  processSessaoPdfArquivos,
  storeIngestBuffer,
  uploadFilesToSessao,
  extractSpreadsheetHeaders,
  EXTRATO_COLUMN_MAP_CAIXA_PIX_JAN,
} from "@spc-up/core";
import { getDb, movimentacao } from "@spc-up/db";
import { and, eq, isNull } from "drizzle-orm";
import { config } from "dotenv";

config();
if (require("node:fs").existsSync(".env.local")) {
  config({ path: ".env.local", override: true });
}

const DOC_DIR = path.join(process.cwd(), "Documentos para teste ");
const PDF_NAME = "Extrato Jan PIX (1).pdf";
const UF = "BA";
const EXERCICIO = 2025;

async function main() {
  const db = getDb();

  console.log("=== 1. Importar cadastro BA ===");
  const xlsxBuf = await readFile(path.join(DOC_DIR, "pessoas bahia (1).xlsx"));
  const preview = await extractSpreadsheetHeaders(xlsxBuf, "pessoas.xlsx");
  const parsed = await parseCadastroSpreadsheet(
    xlsxBuf,
    "pessoas.xlsx",
    preview.suggestedMap,
  );
  const imported = await importCadastroBatch(db, parsed.ok, UF, EXERCICIO);
  console.log(
    `Cadastro: ${imported.inseridos} inseridos, ${imported.atualizados} atualizados, ${imported.erros.length} erros`,
  );

  console.log("\n=== 2. Criar sessão ===");
  const sessao = await createSessao(db, {
    uf: UF,
    tipoPrestador: "ESTADUAL",
    exercicio: EXERCICIO,
    consolidarExtratos: false,
  });
  console.log(`Sessão: ${sessao.id}`);

  const sessaoFull = await getSessao(db, sessao.id);
  if (!sessaoFull) throw new Error("Sessão não encontrada");
  const prestador = prestadorFromSessao(sessaoFull);

  console.log("\n=== 3. Upload PDF ===");
  const pdfBuf = await readFile(path.join(DOC_DIR, PDF_NAME));
  const upload = await uploadFilesToSessao(db, {
    sessaoId: sessao.id,
    diretorioEstadualId: sessao.diretorioEstadualId!,
    uf: UF,
    exercicio: EXERCICIO,
    prestador: {
      cnpjPrestador: prestador.cnpjPrestador,
      tipoPrestador: prestador.tipoPrestador,
      sessaoPrestacaoId: sessao.id,
      diretorioMunicipalId: prestador.diretorioMunicipalId,
    },
    files: [{ filename: PDF_NAME, buffer: pdfBuf }],
    modo: "armazenar",
    persistStorage: storeIngestBuffer,
  });

  const pdfArq = upload.arquivos.find((a) => a.nome === PDF_NAME);
  if (!pdfArq?.arquivo_id) {
    throw new Error(`Upload falhou: ${JSON.stringify(upload.erros)}`);
  }
  console.log(`Arquivo: ${pdfArq.arquivo_id}, ${pdfArq.paginas} pág(s)`);

  console.log("\n=== 4. Processar (NotebookLM + mapa) ===");
  const processResult = await processSessaoPdfArquivos(db, sessao.id, {
    skipConsolidacao: true,
    extratoColumnMaps: { [pdfArq.arquivo_id]: EXTRATO_COLUMN_MAP_CAIXA_PIX_JAN },
  });
  console.log(
    `Movimentações: ${processResult.movimentacoesTotal}`,
    processResult.avisos.length ? `\nAvisos: ${processResult.avisos.join("; ")}` : "",
  );

  console.log("\n=== 5. Re-match determinístico ===");
  const movs = await db.query.movimentacao.findMany({
    where: and(
      eq(movimentacao.sessaoPrestacaoId, sessao.id),
      isNull(movimentacao.deletedAt),
    ),
  });
  for (const mov of movs) {
    await applyDeterministicMatch(db, mov.id);
  }
  console.log(`Re-match em ${movs.length} movimentação(ões)`);

  console.log("\n=== 6. Planilha — remetente + match ===");
  const planilha = await listPlanilhaForSessao(db, sessao.id);
  if (!planilha) throw new Error("Planilha vazia");

  let comRemetente = 0;
  let comPessoa = 0;
  let bate = 0;
  let difere = 0;

  for (const linha of planilha.linhas) {
    const rd = linha.remetenteDestinatario?.trim() ?? "";
    if (rd.length >= 3) comRemetente++;
    if (linha.pessoa) {
      comPessoa++;
      const cmp = compararNomeCadastro(rd, linha.pessoa.nome);
      if (cmp === "bate") bate++;
      if (cmp === "difere") difere++;
      console.log(
        `  linha ${linha.id.slice(0, 8)}… | RD="${rd || "—"}" | cadastro="${linha.pessoa.nome}" | ${cmp} | PF/PJ=${linha.pessoa.tipo}`,
      );
    } else if (rd.length >= 3) {
      console.log(`  linha ${linha.id.slice(0, 8)}… | RD="${rd}" | sem PF/PJ`);
    }
  }

  console.log("\n=== Resumo ===");
  console.log(`Linhas: ${planilha.linhas.length}`);
  console.log(`Com remetenteDestinatario: ${comRemetente}`);
  console.log(`Com pessoa vinculada: ${comPessoa}`);
  console.log(`Comparação bate/difere: ${bate}/${difere}`);
  console.log(`Planilha: http://localhost:3002/prestacao/${sessao.id}/planilha`);

  if (comRemetente === 0) {
    console.error("\nFALHA: nenhuma linha com remetenteDestinatario preenchido");
    process.exit(1);
  }
  if (comPessoa === 0) {
    console.error("\nFALHA: nenhuma linha com pessoa vinculada");
    process.exit(1);
  }
  if (bate === 0 && difere > 0) {
    console.error("\nFALHA: pessoas vinculadas mas nomes divergem");
    process.exit(1);
  }

  console.log("\nOK — mapeamento e match funcionando.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
