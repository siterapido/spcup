import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadEnvFile } from "./load-env";

describe("loadEnvFile", () => {
  const original = process.env.SPC_UP_CLI_TEST_VAR;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SPC_UP_CLI_TEST_VAR;
    } else {
      process.env.SPC_UP_CLI_TEST_VAR = original;
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
});
