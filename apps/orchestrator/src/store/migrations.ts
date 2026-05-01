import { type DatabaseSync } from "node:sqlite";

// Forward-only schema migrations applied at boot. Add new entries to the END
// of the array; never edit or reorder existing ones — names are persisted in
// the schema_migrations table.
export const migrations: readonly { name: string; sql: string }[] = [
  {
    name: "0001_workers",
    sql: `
      CREATE TABLE workers (
        id TEXT PRIMARY KEY,
        hostname TEXT NOT NULL,
        tailscale_name TEXT,
        os TEXT,
        arch TEXT,
        version TEXT,
        labels TEXT,
        registered_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
    `,
  },
  {
    name: "0002_workers_v2",
    sql: `
      ALTER TABLE workers ADD COLUMN control_plane_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE workers ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
    `,
  },
  {
    name: "0003_runs",
    sql: `
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        worker_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        dispatched_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX runs_created_at ON runs(created_at DESC);
    `,
  },
];

/**
 * Apply any not-yet-applied migrations to the given DB handle, recording
 * each in `schema_migrations` so reruns are idempotent. Each migration runs
 * in its own transaction. Safe to call from multiple stores opened against
 * the same DB file — duplicate calls become no-ops.
 *
 * @param db - opened SQLite handle
 * @throws if a migration's SQL fails (transaction rolled back)
 */
export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (
      db.prepare("SELECT name FROM schema_migrations").all() as {
        name: string;
      }[]
    ).map((r) => r.name),
  );
  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );
  for (const m of migrations) {
    if (applied.has(m.name)) {
      continue;
    }
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      insertMigration.run(m.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
