// Barrel for @felafel/db. Two public surfaces:
//
// - `./client` — `createDb`, `Db`, `DbHandle`. The orchestrator imports
//   these from `@felafel/db/client` to construct the persistence layer.
// - `.` — re-exports the same, plus (in D4/D5) the query functions from
//   `./queries/`, so callers can do `import { listWorkers } from "@felafel/db"`.

export { createDb, type Db, type DbHandle } from "@felafel/db/client";
