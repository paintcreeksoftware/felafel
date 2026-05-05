// Wipes the dev-mode orchestrator data dir before the e2e suite runs so
// every run starts from an empty SQLite DB regardless of what local dev
// work left behind. Per-test cleanup of in-run mutations lives in the
// individual specs (e.g., launch.spec's polling test).
//
// Resolves the same path apps/desktop/src/main/orchestrator.ts uses for
// dev-mode runs: <apps/desktop>/.dev-orchestrator-data. Derived from
// `moduleDir/../..` in resolveDataDir, where moduleDir is
// apps/desktop/out/main when the e2e suite boots the bundled
// `out/main/index.js` (unpackaged → dev path, not Electron's userData).
import { rm } from "node:fs/promises";
import { join } from "pathe";

const here = import.meta.dirname;
const desktopRoot = join(here, "..", "..");
const devDataDir = join(desktopRoot, ".dev-orchestrator-data");

export default async function globalSetup(): Promise<void> {
  await rm(devDataDir, { recursive: true, force: true });
}
