// electron-vite config. Three sections because Electron is three programs:
//   main      — the Node process that owns the window and child processes
//   preload   — the bridge script that runs in the renderer with Node access
//   renderer  — the Chromium tab where React lives
//
// All three are fully bundled — no runtime `require`/`import` from
// `node_modules`. `electron` itself and Node builtins (`node:fs`,
// `node:child_process`, …) stay external because they're provided by the
// Electron runtime, not by deps; everything else gets pulled into the
// produced JS so the asar is self-contained at runtime.
//
// We deliberately set `build.externalizeDeps: false` for main and preload
// to suppress electron-vite's default behavior of auto-installing its
// `externalizeDepsPlugin`, which would otherwise mark every package.json
// dep as external. Why we want bundled instead of externalized: with pnpm
// + electron-builder, externalizing forces electron-builder to walk
// `node_modules` at packaging time, and its walker can't follow pnpm's
// nested-version paths (e.g. `which@2` vs `which@6`). The packaged
// AppImage then crashes on launch with `ERR_MODULE_NOT_FOUND: path-key`
// (or any other missing transitive of `execa` etc.) — see
// electron-userland/electron-builder#9654 and PAI-90 for the failure
// surface. Bundling sidesteps the dep walker entirely.
//
// If a future native module ever lands in this app, it MUST be
// externalized — native `.node` binaries can't be bundled by Rollup.
// At that point either re-introduce `externalizeDepsPlugin` scoped to
// the native package(s) only, or pass an explicit `external` array to
// `rollupOptions`. Today the desktop main/preload have no native deps.
// (Historically `better-sqlite3` was the canonical example via
// `@felafel/db`; PAI-103 replaced it with `node:sqlite` so the
// orchestrator sidecar's bundle has no native modules either.)
import { resolve } from "pathe";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

// `@felafel/desktop/*` resolves to `./src/*` in node-side code (main, preload)
// and `./src/renderer/src/*` in renderer code. The double-src in the renderer
// path is electron-vite's convention — its renderer is its own Vite root with
// its own `src/` underneath. The two aliases below mirror what the split
// tsconfigs (tsconfig.node.json + tsconfig.web.json) say.
const nodeAlias = { "@felafel/desktop": resolve(__dirname, "src") };
const rendererAlias = { "@felafel/desktop": resolve(__dirname, "src/renderer/src") };

// `process.env.NODE_ENV = "production"` substituted at build time. Vite
// does this automatically for the renderer config but NOT for main /
// preload (Node contexts), so we have to spell it out. Without it the
// production bundle reads the env var at runtime — typically unset in
// CI / packaged AppImages — and code like
// `process.env.NODE_ENV !== "production"` evaluates to `true`, which is
// how pino tried to spawn pino-pretty as a worker thread and crashed the
// process at startup (PAI-172 e2e regression).
const PRODUCTION_DEFINE = {
  "process.env.NODE_ENV": JSON.stringify("production"),
};

export default defineConfig({
  main: {
    resolve: { alias: nodeAlias },
    define: PRODUCTION_DEFINE,
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    resolve: { alias: nodeAlias },
    define: PRODUCTION_DEFINE,
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    resolve: { alias: rendererAlias },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});
