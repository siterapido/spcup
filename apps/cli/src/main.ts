#!/usr/bin/env node
import { Command } from "commander";

import { runCadastroImport } from "./commands/cadastro-import";
import { runConfirm } from "./commands/confirm";
import { runExport } from "./commands/export";
import { runIngest } from "./commands/ingest";
import { runPendencias } from "./commands/pendencias";
import { runPrestacaoProcess } from "./commands/prestacao-process";
import { runPrestacaoRun } from "./commands/prestacao-run";
import { runPrestacaoStatus } from "./commands/prestacao-status";
import { runPrestacaoUpload } from "./commands/prestacao-upload";
import { runValidateXsd } from "./commands/validate-xsd";
import { loadEnvFile } from "./lib/load-env";

type EnvFileOpts = { envFile?: string };

export function createProgram(): Command {
  const program = new Command();

program
  .name("spcup")
  .description(
    "SPC UP — prestação de contas\n\nFluxo oficial: web cria sessão → spcup prestacao run --sessao <id> --path ./lote/",
  )
    .version("0.1.0");

  const cadastro = program
    .command("cadastro")
    .description("Importação de cadastro PF/PJ");

  cadastro
    .command("import")
    .description("Importar planilha de cadastro PF/PJ")
    .requiredOption("--uf <uf>", "UF")
    .requiredOption("--exercicio <year>", "Exercício")
    .requiredOption("--file <path>", "Planilha xlsx/csv")
    .option("--dry-run", "Parse only, sem persistir")
    .option("--json", "Saída JSON")
    .option("--env-file <path>", "Arquivo .env (default: ~/.spc-up/.env)")
    .action(
      async (
        opts: EnvFileOpts & {
          uf: string;
          exercicio: string;
          file: string;
          dryRun?: boolean;
          json?: boolean;
        },
      ) => {
        loadEnvFile(opts.envFile);
        await runCadastroImport(opts);
      },
    );

  const prestacao = program
    .command("prestacao")
    .description("Upload e processamento de arquivos da sessão");

  prestacao
    .command("upload")
    .description("Enviar OFX/Excel/PDF para a sessão")
    .requiredOption("--sessao <uuid>", "ID da sessão criada na web")
    .requiredOption("--path <path>", "Arquivo ou pasta com OFX/Excel/PDF")
    .option("--json", "Saída JSON")
    .option("--env-file <path>", "Arquivo .env (default: ~/.spc-up/.env)")
    .action(
      async (
        opts: EnvFileOpts & { sessao: string; path: string; json?: boolean },
      ) => {
        loadEnvFile(opts.envFile);
        await runPrestacaoUpload(opts);
      },
    );

  prestacao
    .command("process")
    .description("Processar PDFs pendentes e consolidar")
    .requiredOption("--sessao <uuid>", "ID da sessão")
    .option("--skip-consolidacao", "Não executar consolidação")
    .option("--json", "Saída JSON")
    .option("--env-file <path>", "Arquivo .env (default: ~/.spc-up/.env)")
    .action(
      async (
        opts: EnvFileOpts & {
          sessao: string;
          skipConsolidacao?: boolean;
          json?: boolean;
        },
      ) => {
        loadEnvFile(opts.envFile);
        await runPrestacaoProcess({
          sessao: opts.sessao,
          skipConsolidacao: opts.skipConsolidacao,
          json: opts.json,
        });
      },
    );

  prestacao
    .command("run")
    .description("Upload + process em sequência")
    .requiredOption("--sessao <uuid>", "ID da sessão")
    .requiredOption("--path <path>", "Arquivo ou pasta com OFX/Excel/PDF")
    .option("--skip-consolidacao", "Não executar consolidação")
    .option("--json", "Saída JSON")
    .option("--env-file <path>", "Arquivo .env (default: ~/.spc-up/.env)")
    .action(
      async (
        opts: EnvFileOpts & {
          sessao: string;
          path: string;
          skipConsolidacao?: boolean;
          json?: boolean;
        },
      ) => {
        loadEnvFile(opts.envFile);
        await runPrestacaoRun({
          sessao: opts.sessao,
          path: opts.path,
          skipConsolidacao: opts.skipConsolidacao,
          json: opts.json,
        });
      },
    );

  prestacao
    .command("status")
    .description("Resumo da sessão (arquivos, movimentações, consolidação)")
    .requiredOption("--sessao <uuid>", "ID da sessão")
    .option("--json", "Saída JSON")
    .option("--env-file <path>", "Arquivo .env (default: ~/.spc-up/.env)")
    .action(
      async (opts: EnvFileOpts & { sessao: string; json?: boolean }) => {
        loadEnvFile(opts.envFile);
        await runPrestacaoStatus(opts);
      },
    );

  program
    .command("ingest")
    .description("[legado] Ingerir extratos OFX ou planilhas Excel")
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
