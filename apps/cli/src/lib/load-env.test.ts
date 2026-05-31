import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { envCandidatePaths, loadEnvFile } from "./load-env";

describe("loadEnvFile", () => {
  const keys = [
    "SPC_UP_CLI_TEST_VAR",
    "SPC_UP_CLI_DB",
    "SPC_UP_CLI_OR_KEY",
  ] as const;

  afterEach(() => {
    for (const key of keys) {
      delete process.env[key];
    }
  });

  it("loads variables from an explicit env file", async () => {
    delete process.env.SPC_UP_CLI_TEST_VAR;
    const dir = await mkdtemp(join(tmpdir(), "cli-env-"));
    const envPath = join(dir, ".env");
    try {
      await writeFile(envPath, "SPC_UP_CLI_TEST_VAR=from-file\n", "utf8");
      loadEnvFile(envPath);
      expect(process.env.SPC_UP_CLI_TEST_VAR).toBe("from-file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("merges repo .env and .env.local with later file winning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cli-env-merge-"));
    const prevCwd = process.cwd();
    try {
      process.chdir(dir);
      await writeFile(
        join(dir, ".env"),
        "SPC_UP_CLI_DB=from-dotenv\nSPC_UP_CLI_OR_KEY=openrouter-key\n",
        "utf8",
      );
      await writeFile(join(dir, ".env.local"), "SPC_UP_CLI_DB=from-local\n", "utf8");

      loadEnvFile();

      expect(process.env.SPC_UP_CLI_DB).toBe("from-local");
      expect(process.env.SPC_UP_CLI_OR_KEY).toBe("openrouter-key");
    } finally {
      process.chdir(prevCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips empty placeholder values in earlier files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cli-env-empty-"));
    const prevCwd = process.cwd();
    try {
      process.chdir(dir);
      await writeFile(join(dir, ".env"), "SPC_UP_CLI_DB=\nSPC_UP_CLI_OR_KEY=ok\n", "utf8");

      loadEnvFile();

      expect(process.env.SPC_UP_CLI_DB).toBeUndefined();
      expect(process.env.SPC_UP_CLI_OR_KEY).toBe("ok");
    } finally {
      process.chdir(prevCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists candidate paths in merge order", () => {
    const paths = envCandidatePaths("/tmp/custom.env");
    expect(paths.at(-1)).toBe("/tmp/custom.env");
    expect(paths.some((p) => p.endsWith(".env.local"))).toBe(true);
  });
});
