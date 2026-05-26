#!/usr/bin/env node
import { Command } from "commander";

import { runConfirm } from "./commands/confirm";
import { runExport } from "./commands/export";
import { runIngest } from "./commands/ingest";
import { runPendencias } from "./commands/pendencias";
import { runValidateXsd } from "./commands/validate-xsd";

export function createProgram(): Command {
const program = new Command();

program
  .name("spc-up")
  .description("SPC UP — prestação de contas (ingestão, revisão e exportação SPCA)")
  .version("0.1.0");

program
  .command("ingest")
  .description("Ingerir extratos OFX ou planilhas Excel")
  .requiredOption("--uf <uf>", "UF do diretório estadual (ex.: SP)")
  .requiredOption("--exercicio <year>", "Ano de exercício")
  .requiredOption("--path <path>", "Arquivo ou pasta com OFX/Excel")
  .action(async (opts: { uf: string; exercicio: string; path: string }) => {
    await runIngest(opts);
  });

program
  .command("pendencias")
  .description("Gerar relatório CSV de pendências")
  .requiredOption("--uf <uf>", "UF")
  .requiredOption("--exercicio <year>", "Ano de exercício")
  .requiredOption("--output <path>", "Caminho do CSV de saída")
  .action(async (opts: { uf: string; exercicio: string; output: string }) => {
    await runPendencias(opts);
  });

program
  .command("confirm")
  .description("Confirmar movimentações para exportação")
  .requiredOption("--ids <uuids>", "UUIDs separados por vírgula")
  .action(async (opts: { ids: string }) => {
    await runConfirm(opts);
  });

program
  .command("export")
  .description("Exportar os três XMLs SPCA (origem, aplicação, doação)")
  .requiredOption("--uf <uf>", "UF")
  .requiredOption("--exercicio <year>", "Ano de exercício")
  .requiredOption("--out <dir>", "Diretório de saída dos XMLs")
  .action(async (opts: { uf: string; exercicio: string; out: string }) => {
    await runExport(opts);
  });

program
  .command("validate-xsd")
  .description("Validar um XML contra o XSD SPCA correspondente")
  .requiredOption("--file <path>", "Arquivo XML a validar")
  .requiredOption("--schema <schema>", "Schema: origem, aplicacao ou doacao")
  .action(async (opts: { file: string; schema: string }) => {
    await runValidateXsd(opts);
  });

return program;
}

const isMain =
  typeof require !== "undefined" &&
  require.main === module;

if (isMain) {
  createProgram()
    .parseAsync(process.argv)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    });
}
