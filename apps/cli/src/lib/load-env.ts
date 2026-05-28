import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function loadEnvFile(explicitPath?: string): void {
  const candidates = [
    explicitPath,
    path.join(homedir(), ".spc-up", ".env"),
    path.join(process.cwd(), ".env"),
  ].filter(Boolean) as string[];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq);
      if (process.env[key] == null) {
        process.env[key] = trimmed.slice(eq + 1);
      }
    }
    return;
  }
}
