import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Worker, type WorkerRegistration, WorkerSchema } from "@felafel/shared";
import { migrations } from "./migrations";

export interface WorkerStore {
  list(): Worker[];
  upsert(reg: WorkerRegistration): Worker;
}

interface WorkerRow {
  id: string;
  hostname: string;
  tailscale_name: string | null;
  os: string | null;
  arch: string | null;
  version: string | null;
  labels: string | null;
  registered_at: string;
  last_seen_at: string;
}

function rowToWorker(row: WorkerRow): Worker {
  return WorkerSchema.parse({
    id: row.id,
    hostname: row.hostname,
    tailscaleName: row.tailscale_name ?? undefined,
    os: row.os ?? undefined,
    arch: row.arch ?? undefined,
    version: row.version ?? undefined,
    labels: row.labels ? JSON.parse(row.labels) : undefined,
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
  });
}

export class SqliteWorkerStore implements WorkerStore {
  private db: DatabaseSync;
  private closed = false;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, "orchestrator.sqlite"));
    this.runMigrations();
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const applied = new Set(
      (
        this.db.prepare("SELECT name FROM schema_migrations").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name),
    );
    const insertMigration = this.db.prepare(
      "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
    );
    for (const m of migrations) {
      if (applied.has(m.name)) continue;
      this.db.exec("BEGIN");
      try {
        this.db.exec(m.sql);
        insertMigration.run(m.name, new Date().toISOString());
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
  }

  list(): Worker[] {
    const rows = this.db
      .prepare("SELECT * FROM workers ORDER BY registered_at DESC")
      .all() as unknown as WorkerRow[];
    return rows.map(rowToWorker);
  }

  upsert(reg: WorkerRegistration): Worker {
    const now = new Date().toISOString();
    const labelsJson = reg.labels ? JSON.stringify(reg.labels) : null;
    this.db
      .prepare(
        `
        INSERT INTO workers (id, hostname, tailscale_name, os, arch, version, labels, registered_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          hostname = excluded.hostname,
          tailscale_name = excluded.tailscale_name,
          os = excluded.os,
          arch = excluded.arch,
          version = excluded.version,
          labels = excluded.labels,
          last_seen_at = excluded.last_seen_at
        `,
      )
      .run(
        reg.id,
        reg.hostname,
        reg.tailscaleName ?? null,
        reg.os ?? null,
        reg.arch ?? null,
        reg.version ?? null,
        labelsJson,
        now,
        now,
      );
    const row = this.db
      .prepare("SELECT * FROM workers WHERE id = ?")
      .get(reg.id) as unknown as WorkerRow;
    return rowToWorker(row);
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}
