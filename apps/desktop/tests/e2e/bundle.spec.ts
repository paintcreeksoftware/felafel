// Regression tests for PAI-90: every process the AppImage runs at runtime
// must be self-contained, with no `import "<bare-package>"` statements
// referencing dependencies that aren't shipped beside the bundle.
//
// Lives in `tests/e2e/` because Playwright's `test:e2e` task already
// depends on `build` (see turbo.json), which guarantees the artifacts we
// inspect here exist when the test runs. We don't actually launch
// Electron — these are file-content assertions — but reusing the e2e
// suite avoids adding a new test:integration plumbing layer just for
// these.
//
// What's allowed in a bundle: `electron` (Electron runtime), Node
// builtins (with or without the `node:` prefix), and any subpath of
// either. Anything else means a dep was externalized that won't resolve
// at runtime. See `apps/desktop/electron.vite.config.ts` and
// `apps/orchestrator/tsup.config.ts` for the bundling configuration that
// makes this invariant hold.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "pathe";

const here = import.meta.dirname;
const desktopRoot = join(here, "..", "..");
const repoRoot = join(desktopRoot, "..", "..");

const builtinSet = new Set(builtinModules);

/**
 * True if `id` is allowed to remain external (unbundled) in a built
 * artifact: `electron` itself, anything under `electron/`, anything
 * under `node:`, and Node builtins in the legacy unprefixed form
 * (including subpaths like `fs/promises`).
 * @param id - the bare import specifier to test
 * @returns true if the specifier may remain unbundled
 */
function isAllowedExternal(id: string): boolean {
  if (id === "electron" || id.startsWith("electron/")) {
    return true;
  }
  if (id.startsWith("node:")) {
    return true;
  }
  const [bareTopLevel] = id.split("/");
  return bareTopLevel ? builtinSet.has(bareTopLevel) : false;
}

/**
 * Pull every line-start `import` / `export ... from` specifier out of a
 * bundled ESM source. We anchor on the start of a line (`/m` flag) so we
 * skip example imports inside JSDoc / block-comment example code —
 * bundled libraries like hono carry quoted imports in their own doc
 * comments that aren't real module-level dependencies. Good enough for
 * regression-style assertions; not a full parser.
 * @param src - bundled ESM source contents
 * @returns the list of import specifiers extracted from `src`
 */
function extractImportSpecifiers(src: string): string[] {
  const matches = src.matchAll(
    /^(?:import|export)\s+(?:.*?\s+from\s+)?["'](?<spec>[^"']+)["']/gmu,
  );
  return [...matches]
    .map((m) => m.groups?.spec)
    .filter((id): id is string => id !== undefined);
}

/**
 * Read a built bundle and list any import specifiers that aren't
 * allowed to remain external (per {@link isAllowedExternal} + the
 * caller-supplied `allowed` set).
 * @param bundlePath - absolute path to the built bundle
 * @param allowed - per-bundle allowlist (e.g. native modules shipped as sidecars)
 * @returns the list of externalized specifiers that should have been bundled
 */
function externalizedSpecifiers(bundlePath: string, allowed: ReadonlySet<string> = new Set()): string[] {
  const src = readFileSync(bundlePath, "utf8");
  return [
    ...new Set(
      extractImportSpecifiers(src).filter(
        (id) => !isAllowedExternal(id) && !allowed.has(id),
      ),
    ),
  ];
}

test("desktop main bundle inlines all package deps", () => {
  const bundlePath = join(desktopRoot, "out", "main", "index.js");
  expect(externalizedSpecifiers(bundlePath)).toEqual([]);
});

test("desktop preload bundle inlines all package deps", () => {
  const bundlePath = join(desktopRoot, "out", "preload", "index.mjs");
  expect(externalizedSpecifiers(bundlePath)).toEqual([]);
});

// Specifiers allowed to remain external in the orchestrator sidecar
// bundle. After PAI-103 the bundle has zero native modules, but
// PAI-171 introduced pino + OTel deps whose CJS dynamic-require
// pattern esbuild can't follow into a single-file ESM bundle (`Dynamic
// require of "os" is not supported`). The container path resolves
// them via `pnpm deploy --prod`; the AppImage sidecar packaging that
// would resolve them at the AppImage runtime is the follow-up
// (PAI-183 — orchestrator sidecar ships a node_modules tree).
const NATIVE_MODULES_ALLOWED_EXTERNAL = new Set<string>([
  "pino",
  "pino-pretty",
  "@opentelemetry/api",
  "@opentelemetry/sdk-node",
  "@opentelemetry/sdk-trace-base",
  "@opentelemetry/sdk-trace-node",
  "@opentelemetry/sdk-trace-web",
  "@opentelemetry/exporter-trace-otlp-http",
  "@opentelemetry/auto-instrumentations-node",
  "@opentelemetry/resources",
  "@opentelemetry/context-async-hooks",
]);

test("orchestrator sidecar bundle inlines all non-native deps", () => {
  // Shipped via electron-builder.yml's extraResources block, so the
  // AppImage packs dist/index.mjs without a node_modules tree beside
  // it. Same hygiene requirement as desktop main/preload, modulo the
  // native-module allowlist.
  const bundlePath = join(repoRoot, "apps", "orchestrator", "dist", "index.mjs");
  expect(externalizedSpecifiers(bundlePath, NATIVE_MODULES_ALLOWED_EXTERNAL)).toEqual([]);
});
