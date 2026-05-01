import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "pathe";
import { type Worker, type WorkerRegistration, WorkerSchema } from "@felafel/shared";
import { DB_FILENAME } from "@felafel/orchestrator/constants";
import { migrations } from "@felafel/orchestrator/store/migrations";

/**
 * Storage interface the route layer programs against. Implemented by
 * {@link SqliteWorkerStore}; tests can stub it for in-memory cases.
 */
export interface WorkerStore {
  /** All registered workers, ordered by registration time descending. */
  list(): Worker[];
  /**
   * Insert or update a worker keyed by `id`.
   *
   * @param reg - registration payload from a worker daemon heartbeat
   * @returns the persisted row, after upsert
   */
  upsert(reg: WorkerRegistration): Worker;
}

/** Raw column shape of the `workers` table. snake_case mirrors the SQL. */
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

/**
 * Convert a raw DB row to the public `Worker` shape (camelCase, JSON-parsed
 * labels). Validates via Zod so DB-corruption doesn't propagate as bad
 * runtime values.
 *
 * @param row - raw column values from a SELECT
 * @returns validated `Worker`
 * @throws {ZodError} if the row violates the wire schema
 */
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

/**
 * SQLite-backed implementation of {@link WorkerStore}, using Node 24's
 * built-in `node:sqlite` module. Applies forward-only migrations on
 * construction. Mutations are upsert-by-id; the store does not expose
 * direct DELETE.
 *
 * @remarks
 * Replacing this with Drizzle ORM is captured in the
 * orchestrator-drizzle-orm-migration plan.
 */
export class SqliteWorkerStore implements WorkerStore {
  private readonly db: DatabaseSync;
  private closed = false;

  /**
   * Open (or create) the SQLite database under `dataDir` and apply any
   * pending migrations.
   *
   * @param dataDir - filesystem directory; created if missing. The DB file
   * is named per {@link DB_FILENAME}.
   */
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, DB_FILENAME));
    this.runMigrations();
  }

  /**
   * Apply any not-yet-applied migrations from {@link migrations}, recording
   * each in `schema_migrations` so reruns are idempotent. Each migration
   * runs in its own transaction.
   *
   * @throws if a migration's SQL fails (transaction rolled back)
   */
  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const applied = new Set(
      (
        this.db.prepare("SELECT name FROM schema_migrations").all() as {
          name: string;
        }[]
      ).map((r) => r.name),
    );
    const insertMigration = this.db.prepare(
      "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
    );
    for (const m of migrations) {
      if (applied.has(m.name)) {
        continue;
      }
      this.db.exec("BEGIN");
      try {
        this.db.exec(m.sql);
        insertMigration.run(m.name, new Date().toISOString());
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  /**
   * List all registered workers, newest first by `registered_at`.
   *
   * @returns array of validated `Worker` records
   */
  list(): Worker[] {
    const rows = this.db
      .prepare("SELECT * FROM workers ORDER BY registered_at DESC")
      .all() as unknown as WorkerRow[];
    return rows.map((row) => rowToWorker(row));
  }

  /**
   * Insert a new worker or update an existing one with the same `id`.
   * `registered_at` is preserved on update; `last_seen_at` is bumped to now.
   *
   * @param reg - registration payload
   * @returns the upserted row, normalized through Zod
   */
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

  /**
   * Close the underlying SQLite handle. Idempotent; subsequent calls are
   * no-ops. Call from the orchestrator's shutdown path before exit.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    this.db.close();
    this.closed = true;
  }
}
