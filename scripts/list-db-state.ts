import dotenv from "dotenv";
dotenv.config();

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../packages/db/src/schema";

const databaseUrl = process.env.DATABASE_URL!;

async function main() {
  const db = drizzle(neon(databaseUrl), { schema });
  
  console.log("=== Sessions ===");
  const sessoes = await db.select().from(schema.sessaoPrestacao).limit(10);
  console.log(sessoes.map(s => ({ id: s.id, uf: s.uf, exercicio: s.exercicio, status: s.consolidarExtratos })));

  console.log("\n=== Arquivos Ingestao ===");
  const arquivos = await db.select().from(schema.arquivoIngestao).limit(10);
  console.log(arquivos.map(a => ({ id: a.id, sessao: a.sessaoPrestacaoId, nome: a.nomeArquivo, status: a.status, erro: a.erroMensagem })));

  console.log("\n=== Ingestao Paginas ===");
  const paginas = await db.select().from(schema.ingestaoPagina).limit(10);
  console.log(paginas.map(p => ({ id: p.id, arquivoId: p.arquivoIngestaoId, pagina: p.pagina, status: p.status, aceitas: p.aceitas, incertas: p.incertas })));

  console.log("\n=== Linhas Pendentes ===");
  const pendentes = await db.select().from(schema.ingestaoLinhaPendente).limit(10);
  console.log(pendentes.map(p => ({ id: p.id, arquivoId: p.arquivoIngestaoId, pagina: p.pagina, score: p.score, motivo: p.motivo })));

  console.log("\n=== Movimentacoes ===");
  const movs = await db.select().from(schema.movimentacao).limit(10);
  console.log(movs.map(m => ({ id: m.id, data: m.dataMovimento, valor: m.valor, desc: m.descricaoRaw, status: m.status })));
}

main().catch(console.error);
