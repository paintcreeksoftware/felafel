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
  // Inline EVERY runtime dep into the bundle EXCEPT native modules.
  // Pure-JS deps (hono, @hono/node-server, zod, drizzle-orm, …) get
  // inlined because the orchestrator ships as a *sidecar* inside the
  // desktop AppImage (`electron-builder.yml`'s `extraResources`), and
  // there's no node_modules tree beside it. Without inlining, the
  // packaged sidecar crashes with `ERR_MODULE_NOT_FOUND: …`.
  // Workspace deps (@felafel/shared, @felafel/db, @felafel/contracts)
  // are also inlined for the same reason plus the Node 24 type-strip
  // constraint on workspace TS sources after `pnpm deploy`.
  //
  // EXCEPTION: native modules. `.node` binaries can't be bundled by
  // Rollup/esbuild — their CJS stubs use `require("fs")` at runtime,
  // which doesn't work inside an ESM bundle (you get "Dynamic require
  // of 'fs' is not supported"). better-sqlite3 (introduced via
  // @felafel/db in PAI-89_6) is the first such dep, hence the
  // explicit external entry below.
  //
  // For the Docker service this works cleanly — pnpm deploy ships
  // node_modules and Node loads better-sqlite3 normally. For the
  // AppImage sidecar this surfaces a real follow-up: the asar would
  // need to ship a glibc-compiled better-sqlite3 binary alongside
  // dist/index.mjs, which doesn't fit the "self-contained bundle"
  // shape PAI-90 set up. Tracked separately; the orchestrator-as-Docker
  // case (the immediate driver for PAI-89_6) works.
  // Mark better-sqlite3 as external. It's a native module with
  // `.node` bindings that can't be bundled by Rollup/esbuild — the
  // CJS stub uses `require("fs")` which doesn't work inside an ESM
  // bundle ("Dynamic require of 'fs' is not supported"). The bundle
  // ends up with `import Database from "better-sqlite3"` left as a
  // runtime require, which Node resolves from node_modules normally.
  // better-sqlite3 reaches us transitively via @felafel/db; it
  // doesn't appear in orchestrator's direct package.json deps. tsup
  // doesn't auto-externalize transitive deps, so listing it here
  // explicitly is required.
  external: ["better-sqlite3"],

  // Force-bundle this explicit allowlist (workspace packages + their
  // transitive pure-JS deps that we want self-contained for the
  // AppImage sidecar shape). New pure-JS deps should be added here
  // as they're introduced.
  //
  // Why an explicit list instead of `[/.*/]`: the catch-all regex
  // also matched better-sqlite3 in tsup's matching pass, overriding
  // `external` and inlining the native module's CJS source. The
  // negative-lookahead variant `/^(?!better-sqlite3(\/|$)).*/` had
  // the same problem — tsup's noExternal handling doesn't honor the
  // pattern's exclusion the way one would expect. Allowlist is
  // unambiguous.
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
