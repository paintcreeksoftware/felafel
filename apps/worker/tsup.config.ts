import { defineConfig } from "tsup";

// Mirrors apps/orchestrator/tsup.config.ts, minus the node:sqlite prefix
// shim — the worker has no DB and doesn't trigger esbuild's "node:" stripping
// bug for sqlite imports.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node24",
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  clean: true,
  platform: "node",
  noExternal: ["@felafel/shared"],
});
