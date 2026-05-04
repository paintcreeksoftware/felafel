import { readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "tsup";

// esbuild strips the "node:" prefix from built-in imports during output
// (see https://github.com/evanw/esbuild/issues/2762). For modules with a
// legacy unprefixed alias (fs, path, etc) this is harmless; for node:sqlite
// it breaks at runtime because there is no top-level "sqlite" module. We
// restore the prefix in an onSuccess step rather than fight esbuild's
// resolver. ESM output keeps the import literal so a regex rewrite is safe.
const NODE_BUILTINS_NEEDING_PREFIX = ["sqlite"];

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node24",
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  clean: true,
  platform: "node",
  // Inline EVERY runtime dep into the bundle, not just workspace packages.
  //
  // Workspace deps (@felafel/shared) need bundling because Node 24 refuses
  // to type-strip TypeScript files that live inside node_modules after
  // `pnpm deploy`.
  //
  // Third-party deps (hono, @hono/node-server, zod, …) need bundling
  // because the orchestrator ships as a *sidecar* inside the desktop
  // AppImage — `electron-builder.yml`'s `extraResources` copies
  // `apps/orchestrator/dist/` to `resources/orchestrator/` in the
  // installer, but it does NOT copy a node_modules tree alongside.
  // Without inlining, the packaged sidecar crashes on first launch with
  // `ERR_MODULE_NOT_FOUND: @hono/node-server`. See PAI-90 for the
  // sibling fix on the desktop main bundle.
  //
  // The catch-all regex makes this fail-fast: a future native dep
  // (e.g. `better-sqlite3`) would surface as a build-time esbuild error
  // instead of a silent runtime crash in the packaged build. Today the
  // orchestrator has zero native deps; persistence uses `node:sqlite`,
  // which is a Node builtin, not a package.
  noExternal: [/.*/],
  onSuccess: () => {
    const path = "dist/index.mjs";
    let src = readFileSync(path, "utf8");
    for (const name of NODE_BUILTINS_NEEDING_PREFIX) {
      src = src.replaceAll(
        new RegExp(`from\\s+"${name}"`, "g"),
        `from "node:${name}"`,
      );
    }
    writeFileSync(path, src);
  },
});
