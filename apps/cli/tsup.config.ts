import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["cjs"],
  dts: true,
  noExternal: [/^@spc-up\//],
  shims: true,
});
