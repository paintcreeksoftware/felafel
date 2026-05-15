import { defineConfig } from "tsup";

// Mirrors apps/orchestrator/tsup.config.ts. See that file for the
// full rationale on noExternal/external split + NODE_ENV substitution;
// the worker takes the same shape because it has the same bundling
// constraints (workspace TS-source deps inlined, pino + OTel CJS-
// dynamic-require packages externalized, NODE_ENV substituted so the
// pino-pretty branch is dead-code-eliminated in production).
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node24",
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  clean: true,
  platform: "node",
  env: {
    NODE_ENV: "production",
  },
  noExternal: [
    "@felafel/backend",
    "@felafel/logs",
    "@felafel/shared",
    "@felafel/tailscale",
    "@hono/node-server",
    "@hono/zod-openapi",
    "hono",
    "p-retry",
    "pathe",
    "zod",
  ],
});
