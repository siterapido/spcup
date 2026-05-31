import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 600_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
