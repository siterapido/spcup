import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function applyEnvFromFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    // Ignore empty placeholders (e.g. DATABASE_URL= in ~/.spc-up/.env).
    if (value === "") continue;
    process.env[key] = value;
  }
}

/** Paths loaded in order; later files override earlier non-empty values. */
export function envCandidatePaths(explicitPath?: string): string[] {
  const cwd = process.cwd();
  const paths = [
    path.join(homedir(), ".spc-up", ".env"),
    path.join(cwd, ".env"),
    path.join(cwd, ".env.local"),
  ];
  if (explicitPath) {
    paths.push(path.resolve(explicitPath));
  }
  return paths;
}

/**
 * Load CLI env from ~/.spc-up/.env, repo .env, .env.local, then optional --env-file.
 * Merges so e.g. DATABASE_URL from .env.local and OPENROUTER_API_KEY from .env both apply.
 */
export function loadEnvFile(explicitPath?: string): void {
  for (const filePath of envCandidatePaths(explicitPath)) {
    applyEnvFromFile(filePath);
  }
}
