// electron-vite config. Three sections because Electron is three programs:
//   main      — the Node process that owns the window and child processes
//   preload   — the bridge script that runs in the renderer with Node access
//   renderer  — the Chromium tab where React lives
//
// `externalizeDepsPlugin` leaves Node `import`s as runtime requires instead of
// bundling them — necessary for native modules and for things electron-builder
// must see in node_modules at packaging time. We `exclude: ["@felafel/shared"]`
// because that workspace package is pure TS source and Node can't load .ts at
// runtime; bundling it inlines `Channels` directly into main/preload output.
// `@felafel/ui` is renderer-only and the renderer section below doesn't use
// externalizeDepsPlugin (Vite bundles everything for the browser), so it
// doesn't need to be listed.
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const aliasToSrc = { "@": resolve(__dirname, "src") };

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@felafel/shared"] })],
    resolve: { alias: aliasToSrc },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@felafel/shared"] })],
    resolve: { alias: aliasToSrc },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    resolve: { alias: aliasToSrc },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});
