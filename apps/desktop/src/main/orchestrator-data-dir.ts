// Filesystem location for the orchestrator's persistent data (its
// SQLite DB lives here). Packaged builds nest under Electron's
// `userData`; dev points at a gitignored repo-local folder.
//
// Extracted out of orchestrator.ts so OrchestratorManager.start()
// stays focused on lifecycle wiring, and so the path-vs-mkdir pairing
// lives in one place.
import { mkdir } from "node:fs/promises";
import { app } from "electron";
import { join } from "pathe";

const moduleDir = import.meta.dirname;

/**
 * Resolve the orchestrator's data directory and ensure it exists.
 *
 * @remarks
 * In packaged builds: nested under Electron's `userData` so per-user
 * state survives reinstall. In dev: a gitignored repo-local folder so
 * an editor reload doesn't blow away the dev DB.
 *
 * @returns absolute path to the data directory (created if missing)
 */
export async function ensureDataDir(): Promise<string> {
  const dir = resolveDataDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function resolveDataDir(): string {
  if (app.isPackaged) {
    return join(app.getPath("userData"), "orchestrator");
  }
  return join(moduleDir, "..", "..", ".dev-orchestrator-data");
}
