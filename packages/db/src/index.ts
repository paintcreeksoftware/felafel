// Barrel for @felafel/db. The barrel re-exports the client + every query
// function so callers can do `import { createDb, listWorkers } from
// "@felafel/db"` without remembering subpath layouts.
//
// Subpath exports (`@felafel/db/client`, `@felafel/db/queries/workers`,
// etc.) are still available for tree-shaking-conscious callers.

export { createDb, type Db, type DbHandle } from "@felafel/db/client";

export {
  listWorkers,
  markWorkersStaleSince,
  upsertWorker,
} from "@felafel/db/queries/workers";

export {
  getRun,
  insertRun,
  listRuns,
  markRunComplete,
  markRunDispatched,
  markRunFailed,
  markRunsTimedOutSince,
} from "@felafel/db/queries/runs";
