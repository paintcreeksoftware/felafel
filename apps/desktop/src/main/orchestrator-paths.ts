// Filesystem path resolver for the orchestrator's bundled entrypoint.
// Packaged and dev modes diverge enough that the path logic is worth
// its own file — and folding the existsSync precondition into the
// resolver lets the caller throw + log in one place instead of two.
//
// Extracted out of orchestrator.ts so OrchestratorManager.start() stops
// owning filesystem detection alongside child-process lifecycle.
import { existsSync } from "node:fs";
import { app } from "electron";
import { join } from "pathe";
import { DesktopEnvVars } from "@felafel/desktop/main/constants";

const moduleDir = import.meta.dirname;

/**
 * Resolve the orchestrator's bundled `.mjs` entrypoint and verify it
 * exists on disk.
 *
 * @remarks
 * In dev: the workspace package's `dist/index.mjs` discovered by
 * walking up from this file's location. In packaged builds: the file
 * electron-builder placed under `process.resourcesPath/orchestrator/`.
 * The `FELAFEL_ORCHESTRATOR_FAKE_BUNDLE` env override exists for tests.
 *
 * @returns absolute path to the orchestrator entrypoint
 * @throws if the entrypoint is missing on disk (build hasn't run)
 */
export function resolveScriptPath(): string {
  const path = computePath();
  if (!existsSync(path)) {
    throw new Error(
      `orchestrator bundle missing at ${path}. Run \`pnpm --filter @felafel/orchestrator build\`.`,
    );
  }
  return path;
}

function computePath(): string {
  const fake = process.env[DesktopEnvVars.FELAFEL_ORCHESTRATOR_FAKE_BUNDLE];
  if (fake) {
    return fake;
  }
  if (app.isPackaged) {
    return join(process.resourcesPath, "orchestrator", "index.mjs");
  }
  // moduleDir is apps/desktop/out/main → up three to reach apps/, then into
  // orchestrator/dist/index.mjs.
  return join(moduleDir, "..", "..", "..", "orchestrator", "dist", "index.mjs");
}
