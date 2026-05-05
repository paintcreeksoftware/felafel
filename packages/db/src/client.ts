import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { mkdirSync } from "node:fs";
import { join, resolve } from "pathe";

import { runs, workers } from "@felafel/contracts/schema";

// Drizzle's runtime schema map. Add new tables here as the contracts
// package gains them; keep alphabetical for review-stability.
const schema = { runs, workers };

/**
 * Drizzle handle typed against the contracts schema. Returned from
 * `createDb`; consumed by every query function in `src/queries/`.
 */
export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * What `createDb` returns. The orchestrator holds onto both — `db` is the
 * Drizzle handle the route layer reads/writes against, `close` is the
 * cleanup hook for SIGTERM that releases the SQLite file lock.
 */
export interface DbHandle {
  db: Db;
  close: () => void;
}

const DB_FILENAME = "orchestrator.sqlite";

// Resolve the `migrations/` folder that ships alongside this package's
// source. Works in dev (tsx running source files directly) because
// import.meta.dirname points at packages/db/src/. Bundled-mode resolution
// (tsup output) is a follow-up concern handled when the orchestrator's
// tsup config gets a copy-migrations step in D6.
const DEFAULT_MIGRATIONS_FOLDER = resolve(import.meta.dirname, "..", "migrations");

/**
 * Open (or create) the orchestrator's SQLite database under `dataDir`,
 * apply every pending migration from the package's `migrations/` folder,
 * and return a Drizzle handle ready for query functions.
 *
 * The directory is created with `recursive: true` if missing, matching the
 * previous `SqliteWorkerStore` constructor's behavior.
 *
 * The query logger is enabled unconditionally — every SQL statement
 * Drizzle issues is logged to stdout. That's the default we want during
 * development, testing, and the early production phase; revisit (gate on
 * env var) once log volume becomes a concern.
 *
 * @param dataDir - filesystem directory for `orchestrator.sqlite`; created if missing.
 * @param migrationsFolder - override the default migrations folder. Tests pass an explicit path; production callers should rely on the default.
 * @returns Drizzle handle plus a `close()` cleanup hook.
 */
export function createDb(dataDir: string, migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER): DbHandle {
  mkdirSync(dataDir, { recursive: true });
  // node:sqlite's DatabaseSync is the underlying handle; pass it as
  // `client` to drizzle 1.0's config-object overload (the (path, config)
  // overload doesn't fit since we already constructed the connection).
  const sqlite = new DatabaseSync(join(dataDir, DB_FILENAME));
  const db = drizzle({ client: sqlite, schema, logger: true });
  migrate(db, { migrationsFolder });
  let closed = false;
  return {
    db,
    // Idempotent: better-sqlite3 used to swallow double-close; node:sqlite
    // throws "database is not open." Cleanup paths in tests + SIGTERM
    // handlers occasionally call close twice, so guard explicitly rather
    // than rely on driver behavior.
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      sqlite.close();
    },
  };
}
