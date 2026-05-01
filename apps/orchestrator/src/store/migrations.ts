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
];
