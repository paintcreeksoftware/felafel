// Wipes the dev-mode orchestrator data dir before the e2e suite runs so
// every run starts from an empty SQLite DB regardless of what local dev
// work left behind. Per-test cleanup of in-run mutations lives in the
// individual specs (e.g., launch.spec's polling test).
//
// Resolves the same path apps/desktop/src/main/orchestrator.ts uses for
// dev-mode runs: <repo-root>/.dev-orchestrator-data. The e2e suite boots
// the bundled `out/main/index.js` which is unpackaged from Electron's
// perspective (`app.isPackaged === false`), so it lands in the dev path,
// not Electron's userData.
import { rm } from "node:fs/promises";
import { join } from "pathe";

const here = import.meta.dirname;
const repoRoot = join(here, "..", "..", "..", "..");
const devDataDir = join(repoRoot, ".dev-orchestrator-data");

export default async function globalSetup(): Promise<void> {
  await rm(devDataDir, { recursive: true, force: true });
}
