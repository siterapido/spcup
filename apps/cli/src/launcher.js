#!/usr/bin/env node
/**
 * spcup launcher — funciona instalado via npm global ou no monorepo (dev).
 *
 *   spcup install / spcup setup   configura ~/.spc-up/.env (usuário final)
 *   spcup <comando>               cadastro, prestacao, …
 */
const { spawnSync, execSync } = require("node:child_process");
const {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LAUNCHER_DIR = __dirname;
const PACKAGED_MAIN = path.join(LAUNCHER_DIR, "main.js");
const CONFIG_DIR = path.join(os.homedir(), ".spc-up");
const ENV_FILE = path.join(CONFIG_DIR, ".env");
const NEED_NODE = 20;

const ENV_TEMPLATE = `# Configuração spcup — preencha com os dados fornecidos pela UP
DATABASE_URL=
OPENROUTER_API_KEY=
OPENROUTER_PDF_MODEL=google/gemini-3.5-flash
OPENROUTER_MODEL=google/gemini-3.5-flash
OPENROUTER_CACHE=1
OPENROUTER_PDF_TIMEOUT_MS=180000
MAX_EXTRATO_PAGES=12
STORAGE_ROOT=./data/uploads
AUTH_URL=
`;

function monorepoRoot() {
  const fromEnv = process.env.SPCUP_MONOREPO_ROOT;
  if (fromEnv && existsSync(path.join(fromEnv, "apps", "cli", "package.json"))) {
    return path.resolve(fromEnv);
  }
  const candidate = path.resolve(LAUNCHER_DIR, "..", "..", "..");
  if (existsSync(path.join(candidate, "apps", "cli", "package.json"))) {
    return candidate;
  }
  return null;
}

function isPackagedInstall() {
  return existsSync(PACKAGED_MAIN);
}

function resolveCliMain() {
  if (isPackagedInstall()) {
    return { main: PACKAGED_MAIN, root: null, packaged: true };
  }
  const root = monorepoRoot();
  if (root) {
    return {
      main: path.join(root, "apps", "cli", "dist", "main.js"),
      root,
      packaged: false,
    };
  }
  return null;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] == null) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

function loadDefaultEnv(root) {
  loadEnvFile(ENV_FILE);
  if (root) loadEnvFile(path.join(root, ".env"));
}

function ensureNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < NEED_NODE) {
    process.stderr.write(
      `Node.js ${NEED_NODE}+ é obrigatório (encontrado: ${process.version}).\n` +
        "Baixe em https://nodejs.org/\n",
    );
    process.exit(1);
  }
}

function needsBuild(root) {
  const dist = path.join(root, "apps", "cli", "dist", "main.js");
  const entry = path.join(root, "apps", "cli", "src", "main.ts");
  if (!existsSync(dist)) return true;
  if (!existsSync(entry)) return false;
  return statSync(entry).mtimeMs > statSync(dist).mtimeMs;
}

function ensureBuilt(root) {
  if (!needsBuild(root)) return;
  process.stderr.write("→ Compilando spcup (dev)...\n");
  execSync("pnpm --filter @spc-up/cli build", {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

function runSetup() {
  ensureNode();
  mkdirSync(CONFIG_DIR, { recursive: true });

  const created = !existsSync(ENV_FILE);
  if (created) {
    writeFileSync(ENV_FILE, ENV_TEMPLATE, "utf8");
  }

  process.stdout.write("\n✓ spcup configurado\n\n");
  process.stdout.write(`Arquivo: ${ENV_FILE}\n\n`);

  if (created) {
    process.stdout.write(
      "Edite o arquivo e preencha pelo menos:\n" +
        "  DATABASE_URL      (fornecido pela UP)\n" +
        "  OPENROUTER_API_KEY (fornecido pela UP, necessário para PDF)\n\n",
    );
  } else {
    process.stdout.write(
      "Revise DATABASE_URL e OPENROUTER_API_KEY se ainda não configurou.\n\n",
    );
  }

  process.stdout.write("Fluxo:\n");
  process.stdout.write("  1. Web (UP): criar sessão em /prestacao/nova\n");
  process.stdout.write("  2. spcup cadastro import --uf XX --exercicio 2025 --file pessoas.xlsx\n");
  process.stdout.write(
    "  3. spcup prestacao run --sessao <uuid> --path ./seus-arquivos/\n",
  );
  process.stdout.write("  4. Web: revisar kanban e exportar\n\n");

  const env = readFileSync(ENV_FILE, "utf8");
  const hasDb = /^DATABASE_URL=\s*\S+/m.test(env);
  const hasOr = /^OPENROUTER_API_KEY=\s*\S+/m.test(env);
  if (!hasDb || !hasOr) {
    process.stdout.write(
      "⚠ Pendente: complete ~/.spc-up/.env antes de processar extratos.\n",
    );
  }
}

function runCli(args) {
  const resolved = resolveCliMain();
  if (!resolved) {
    process.stderr.write(
      "spcup não encontrado.\n\n" +
        "Instale com o instalador da UP:\n" +
        "  curl -fsSL <URL>/install-spcup.sh | bash\n\n" +
        "Ou, para desenvolvedores, clone o repositório e use ./bin/spcup\n",
    );
    process.exit(1);
  }

  loadDefaultEnv(resolved.root);
  if (!resolved.packaged && resolved.root) {
    ensureBuilt(resolved.root);
  }

  if (!existsSync(resolved.main)) {
    process.stderr.write(`CLI não compilada: ${resolved.main}\n`);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [resolved.main, ...args], {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  });

  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 1 && (args[0] === "install" || args[0] === "setup")) {
    runSetup();
    return;
  }

  if (args.length === 0) {
    runCli(["--help"]);
    return;
  }

  runCli(args);
}

main();
