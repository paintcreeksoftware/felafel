// Query functions for the `workers` table. Pure functions taking the
// Drizzle handle as the first argument (Decision #4 from the plan —
// functional, not repository classes).
//
// `better-sqlite3` is synchronous, so these return values directly with
// no `await`. That's a deliberate API shape; async-over-sync would be
// misleading.

import { and, desc, eq, lt, ne } from "drizzle-orm";

import { type Worker, type WorkerRegistration } from "@felafel/contracts";
import { workers } from "@felafel/contracts/schema";
import { type Db } from "@felafel/db/client";
import { rowToWorker } from "@felafel/db/conversions";

/**
 * List every registered worker, newest registration first.
 *
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
 *
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
 * Mark every worker whose `lastSeenAt` is older than `threshold` as stale.
 *
 * Skips rows already in `"stale"` to avoid pointless writes (and to make
 * the return value mean "newly stale" rather than "matched the threshold").
 * Used by the orchestrator's periodic sweep.
 *
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
