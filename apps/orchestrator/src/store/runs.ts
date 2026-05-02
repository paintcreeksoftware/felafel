import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "pathe";
import { type Run, RunSchema } from "@felafel/shared";
import { DB_FILENAME } from "@felafel/orchestrator/constants";
import { runMigrations } from "@felafel/orchestrator/store/migrations";

/**
 * Storage interface the runs route layer programs against. Implemented by
 * {@link SqliteRunStore}; tests can stub it for in-memory cases.
 */
export interface RunStore {
  /** Insert a new run with status='pending'. */
  insert(payload: Record<string, unknown>): Run;
  /** Mark a run dispatched + record which worker received it. */
  markDispatched(id: string, workerId: string): Run;
  /** Mark a run complete with optional result-error string. */
  markComplete(id: string, error?: string): Run;
  /** Mark a run failed with a required error message. */
  markFailed(id: string, error: string): Run;
  /** All runs, newest-first by `created_at`. */
  list(): Run[];
  /** Single run by id, or undefined if missing. */
  get(id: string): Run | undefined;
}

/** Raw column shape of the `runs` table. snake_case mirrors the SQL. */
interface RunRow {
  id: string;
  payload: string;
  status: string;
  worker_id: string | null;
  error: string | null;
  created_at: string;
  dispatched_at: string | null;
  completed_at: string | null;
}

/**
 * Convert a raw DB row to the public `Run` shape. Validates via Zod so
 * DB-corruption doesn't propagate as bad runtime values.
 *
 * @param row - raw column values from a SELECT
 * @returns validated `Run`
 * @throws {ZodError} if the row violates the wire schema
 */
function rowToRun(row: RunRow): Run {
  return RunSchema.parse({
    id: row.id,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    status: row.status,
    workerId: row.worker_id ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    dispatchedAt: row.dispatched_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  });
}

/**
 * SQLite-backed implementation of {@link RunStore}. Mirrors
 * {@link import("./sqlite.js").SqliteWorkerStore}'s constructor pattern —
 * opens its own connection to the shared `orchestrator.sqlite` file and
 * runs migrations on construction. Migrations are idempotent (keyed by name
 * in `schema_migrations`), so it's safe for both stores to call them.
 */
export class SqliteRunStore implements RunStore {
  private readonly db: DatabaseSync;
  private closed = false;

  /**
   * Open the shared SQLite database under `dataDir` and apply any pending
   * migrations.
   *
   * @param dataDir - filesystem directory; created if missing. The DB file
   * is named per `DB_FILENAME` and shared with `SqliteWorkerStore`.
   */
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, DB_FILENAME));
    runMigrations(this.db);
  }

  /**
   * Insert a new run with status='pending'. The id is server-generated
   * (UUID v4); callers don't supply it.
   *
   * @param payload - opaque job payload, JSON-serialized for storage
   * @returns the persisted Run record
   */
  insert(payload: Record<string, unknown>): Run {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO runs (id, payload, status, created_at)
        VALUES (?, ?, 'pending', ?)
        `,
      )
      .run(id, JSON.stringify(payload), now);
    return this.get(id) as Run;
  }

  /**
   * Flip status to 'dispatched' and record which worker received it.
   * Caller is responsible for invoking this only after a successful
   * outbound dispatch to the worker.
   *
   * @param id - run id
   * @param workerId - the worker that accepted the dispatch
   * @returns the updated Run record
   */
  markDispatched(id: string, workerId: string): Run {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE runs SET status = 'dispatched', worker_id = ?, dispatched_at = ?
        WHERE id = ?
        `,
      )
      .run(workerId, now, id);
    return this.get(id) as Run;
  }

  /**
   * Flip status to 'complete'. Used by the worker's ack callback when
   * the job succeeded.
   *
   * @param id - run id
   * @param error - optional warning-level message that doesn't fail the
   * run (rare; reserved for partial-success edge cases)
   * @returns the updated Run record
   */
  markComplete(id: string, error?: string): Run {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE runs SET status = 'complete', completed_at = ?, error = ?
        WHERE id = ?
        `,
      )
      .run(now, error ?? null, id);
    return this.get(id) as Run;
  }

  /**
   * Flip status to 'failed'. Used both when the worker's ack reports
   * `ok: false` and when the periodic sweep catches a hung dispatch.
   *
   * @param id - run id
   * @param error - human-readable failure reason
   * @returns the updated Run record
   */
  markFailed(id: string, error: string): Run {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE runs SET status = 'failed', completed_at = ?, error = ?
        WHERE id = ?
        `,
      )
      .run(now, error, id);
    return this.get(id) as Run;
  }

  /**
   * List all runs, newest-first by `created_at`.
   *
   * @returns array of validated Run records
   */
  list(): Run[] {
    const rows = this.db
      .prepare("SELECT * FROM runs ORDER BY created_at DESC")
      .all() as unknown as RunRow[];
    return rows.map((row) => rowToRun(row));
  }

  /**
   * Look up a single run by id.
   *
   * @param id - run id
   * @returns the Run record, or undefined if no row matches
   */
  get(id: string): Run | undefined {
    const row = this.db
      .prepare("SELECT * FROM runs WHERE id = ?")
      .get(id) as unknown as RunRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    return rowToRun(row);
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
