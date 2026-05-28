import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts", "src/launcher.js"],
  format: ["cjs"],
  dts: {
    entry: ["src/main.ts"],
  },
  // Bundle workspace packages; keep native canvas external (loaded at runtime from node_modules)
  noExternal: [/^@spc-up\//],
  external: ["@napi-rs/canvas"],
  shims: true,
});
