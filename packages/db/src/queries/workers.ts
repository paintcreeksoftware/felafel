// Query functions for the `workers` table. Pure functions taking the
// Drizzle handle as the first argument (Decision #4 from the plan —
// functional, not repository classes).
//
// `node:sqlite`'s DatabaseSync is synchronous, so these return values
// directly with no `await`. That's a deliberate API shape; async-over-sync
// would be misleading.

import { and, desc, eq, lt, ne } from "drizzle-orm";

import { type Worker, type WorkerRegistration } from "@felafel/contracts";
import { runs, workers } from "@felafel/contracts/schema";
import { type Db } from "@felafel/db/client";
import { rowToWorker } from "@felafel/db/conversions";

/**
 * List every registered worker, newest registration first.
 * @param db - Drizzle handle, typically `opts.db` in the orchestrator app.
 * @returns all worker rows, parsed through the wire `WorkerSchema`.
 */
export function listWorkers(db: Db): Worker[] {
  return db
    .select()
    .from(workers)
    .orderBy(desc(workers.registeredAt))
    .all()
    .map((row) => rowToWorker(row));
}

/**
 * Insert a new worker or update an existing one matched by `worker_id`
 * (the wire UUID), then return the post-upsert row.
 *
 * Mirrors the previous `SqliteWorkerStore.upsert` behavior exactly:
 * - `registeredAt` is set to `now` only on first insert; preserved on
 *   conflict (worker re-registration doesn't reset its registration time).
 * - `lastSeenAt` is bumped to `now` on every call — registration is also
 *   the heartbeat path, so re-registration counts as a heartbeat.
 * - `status` is forced back to `"active"` on every call, undoing any
 *   previous `"stale"` flip from the periodic sweep.
 * @param db - Drizzle handle.
 * @param reg - validated registration payload from the worker daemon.
 * @returns the upserted row, parsed through the wire `WorkerSchema`.
 */
export function upsertWorker(db: Db, reg: WorkerRegistration): Worker {
  const now = new Date().toISOString();
  const labels = reg.labels ? JSON.stringify(reg.labels) : null;
  db.insert(workers)
    .values({
      workerId: reg.id,
      hostname: reg.hostname,
      tailscaleName: reg.tailscaleName ?? null,
      os: reg.os ?? null,
      arch: reg.arch ?? null,
      version: reg.version ?? null,
      labels,
      controlPlaneUrl: reg.controlPlaneUrl,
      status: "active",
      registeredAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: workers.workerId,
      set: {
        hostname: reg.hostname,
        tailscaleName: reg.tailscaleName ?? null,
        os: reg.os ?? null,
        arch: reg.arch ?? null,
        version: reg.version ?? null,
        labels,
        controlPlaneUrl: reg.controlPlaneUrl,
        status: "active",
        lastSeenAt: now,
      },
    })
    .run();
  const row = db.select().from(workers).where(eq(workers.workerId, reg.id)).get();
  if (!row) {
    throw new Error(`upsert returned no row for worker_id ${reg.id}`);
  }
  return rowToWorker(row);
}

/**
 * Outcome of {@link deleteWorker}. A discriminated result so callers can
 * pattern-match on the case rather than parse error strings — the HTTP
 * route maps each variant to a distinct status code.
 */
export type DeleteWorkerResult =
  | { outcome: "deleted" }
  | { outcome: "missing" }
  | { outcome: "blocked"; referencingRunCount: number };

/**
 * Hard-delete a worker by its wire UUID. Refuses (`outcome: "blocked"`)
 * if any rows in `runs` reference this `worker_id` — preserves run
 * history rather than orphaning FK columns or cascading deletes. The
 * caller can either kill the referencing runs first or accept that
 * the worker stays as a forever-stale row for audit purposes.
 *
 * SQLite's `PRAGMA foreign_keys` is off in our setup, so the `references()`
 * declaration in the schema is advisory only — we do the FK check
 * ourselves. Counting referencing rows up-front (rather than catching
 * a constraint error) lets us return the count in the result, which the
 * UI surfaces in the "can't forget yet — N runs reference this worker"
 * message.
 * @param db - Drizzle handle.
 * @param workerId - the wire UUID, stored in the `worker_id` column.
 * @returns discriminated result. "deleted" on success, "missing" if no
 * such row, "blocked" with the referencing run count otherwise.
 */
export function deleteWorker(db: Db, workerId: string): DeleteWorkerResult {
  const exists = db
    .select({ id: workers.id })
    .from(workers)
    .where(eq(workers.workerId, workerId))
    .get();
  if (!exists) {
    return { outcome: "missing" };
  }
  const referencing = db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.workerId, workerId))
    .all();
  if (referencing.length > 0) {
    return { outcome: "blocked", referencingRunCount: referencing.length };
  }
  db.delete(workers).where(eq(workers.workerId, workerId)).run();
  return { outcome: "deleted" };
}

/**
 * Mark every worker whose `lastSeenAt` is older than `threshold` as stale.
 *
 * Skips rows already in `"stale"` to avoid pointless writes (and to make
 * the return value mean "newly stale" rather than "matched the threshold").
 * Used by the orchestrator's periodic sweep.
 * @param db - Drizzle handle.
 * @param threshold - ISO 8601 timestamp; workers with `lastSeenAt < threshold` are flipped.
 * @returns count of rows newly transitioned to `"stale"`.
 */
export function markWorkersStaleSince(db: Db, threshold: string): number {
  const result = db
    .update(workers)
    .set({ status: "stale" })
    .where(and(lt(workers.lastSeenAt, threshold), ne(workers.status, "stale")))
    .run();
  return Number(result.changes);
}
