import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { create } from "xmlbuilder2";

type XMLBuilder = ReturnType<typeof create>;

export const ORIGEM_NS = "http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd";
export const APLICACAO_NS = "http://www.tse.jus.br/2012/XMLSchema/aplicacaoRecurso.xsd";
export const DOACAO_NS =
  "http://www.tse.jus.br/2012/XMLSchema/doacaoFinanceiraPartidoCandidato.xsd";

export const DEFAULT_STORAGE_ROOT = "./data/uploads";

export function storageRoot(): string {
  return process.env.STORAGE_ROOT ?? DEFAULT_STORAGE_ROOT;
}

export function exportPath(
  uf: string,
  exercicio: number,
  cnpj: string,
  stem: "origem" | "aplicacao" | "doacao",
): string {
  return join(storageRoot(), "exports", uf, String(exercicio), `${stem}_${cnpj}.xml`);
}

export function makeOrigemRoot(): XMLBuilder {
  return create({ version: "1.0", encoding: "UTF-8" }).ele("spcaImportacaoArquivo", {
    xmlns: ORIGEM_NS,
  });
}

export function makeAplicacaoRoot(): XMLBuilder {
  return create({ version: "1.0", encoding: "UTF-8" }).ele("importacaoAplicacaoRecurso", {
    xmlns: APLICACAO_NS,
  });
}

export function makeDoacaoRoot(): XMLBuilder {
  return create({ version: "1.0", encoding: "UTF-8" }).ele("spcaImportacaoArquivo", {
    xmlns: DOACAO_NS,
  });
}

export function sub(
  parent: XMLBuilder,
  tag: string,
  text?: string | number | null,
): XMLBuilder {
  const element = parent.ele(tag);
  if (text != null) {
    element.txt(String(text));
  }
  return element;
}

export function buildCabecalho(
  parent: XMLBuilder,
  options: { cnpj: string; exercicio: number },
): void {
  const cabecalho = sub(parent, "CABECALHO");
  sub(cabecalho, "nrCnpjPrestador", options.cnpj);
  sub(cabecalho, "anoExercicio", options.exercicio);
}

export function formatMoeda(value: string | number): string {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return n.toFixed(2);
}

export async function writeXml(doc: XMLBuilder, path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const xml = doc.end({ prettyPrint: true });
  await writeFile(path, xml, "utf-8");
  return path;
}

export function xmlToBuffer(doc: XMLBuilder): Buffer {
  return Buffer.from(doc.end({ prettyPrint: true }), "utf-8");
}
