import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
  // Inline EVERY runtime dep into the bundle. The orchestrator ships
  // as a *sidecar* inside the desktop AppImage (`electron-builder.yml`'s
  // `extraResources`), and there's no node_modules tree beside it.
  // Without inlining, the packaged sidecar crashes with
  // `ERR_MODULE_NOT_FOUND: …`.
  // Workspace deps (@felafel/shared, @felafel/db, @felafel/contracts)
  // are also inlined for the same reason plus the Node 24 type-strip
  // constraint on workspace TS sources after `pnpm deploy`.
  //
  // No `external` entries: with the PAI-103 cutover from better-sqlite3
  // to node:sqlite (a Node built-in, not an npm dep), the orchestrator
  // bundle has zero native modules left. If a future native dep ever
  // returns, the AppImage's extraResources packaging needs a parallel
  // node_modules path or the dep should be evaluated for replacement
  // by a built-in / pure-JS alternative first.
  noExternal: [
    "@felafel/shared",
    "@felafel/contracts",
    "@felafel/db",
    "@hono/node-server",
    "@hono/zod-openapi",
    "hono",
    "drizzle-orm",
    "drizzle-zod",
    "pathe",
    "zod",
  ],
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

    // Copy @felafel/db's migrations folder to apps/orchestrator/migrations
    // so it's a sibling of dist/. The bundled @felafel/db code resolves
    // `migrationsFolder` via `import.meta.dirname` (which after bundling
    // points at .../dist), then walks `..` to find migrations. In Docker
    // the runtime stage handles this with its own COPY step; for
    // integration tests and `pnpm dev` runs, the bundle output here is
    // what's executed and it needs the migrations folder beside it.
    //
    // rmSync first so a renamed migration (e.g. drizzle-kit producing a
    // new tag) doesn't leave a stale file under the old name.
    const dbMigrationsSrc = resolve(__dirname, "..", "..", "packages", "db", "migrations");
    const orchestratorMigrationsDest = resolve(__dirname, "migrations");
    rmSync(orchestratorMigrationsDest, { recursive: true, force: true });
    cpSync(dbMigrationsSrc, orchestratorMigrationsDest, { recursive: true });
  },
});
