// Query functions for the `runs` table. Pure functions taking the Drizzle
// handle as the first argument (Decision #4: functional, not repository
// classes). `node:sqlite`'s DatabaseSync is synchronous, so these return
// values directly with no `await`.
//
// State transitions are guarded against going backwards from a terminal
// state (PAI-110): markRunDispatched only fires from `pending`,
// markRunComplete / markRunFailed only fire from `pending` or `dispatched`.
// If the guard rejects, the function returns the row's current state
// rather than throwing — the caller can inspect `status` to see what
// happened. This keeps the API ergonomic while preventing the dispatch /
// complete write race that could clobber a terminal status.

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt } from "drizzle-orm";

import { type Run } from "@felafel/contracts";
import { runs } from "@felafel/contracts/schema";
import { type Db } from "@felafel/db/client";
import { rowToRun } from "@felafel/db/conversions";

/**
 * Insert a new run with `status='pending'`. The id is server-generated
 * (UUID v4 via `crypto.randomUUID()`); callers don't supply it.
 *
 * @param db - Drizzle handle.
 * @param payload - opaque job payload, JSON-serialized for storage.
 * @returns the persisted `Run` record (post-insert SELECT, parsed through
 * the wire `RunSchema`).
 */
export function insertRun(db: Db, payload: Record<string, unknown>): Run {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(runs)
    .values({
      runId: id,
      payload: JSON.stringify(payload),
      status: "pending",
      createdAt: now,
    })
    .run();
  const run = getRun(db, id);
  if (!run) {
    throw new Error(`insert returned no row for run_id ${id}`);
  }
  return run;
}

/**
 * Flip a run's status to `'dispatched'` and record which worker accepted
 * it. Guarded against going backwards: only fires when current status is
 * `pending`. If status has already advanced (the worker's complete
 * callback raced past us — possible when dispatched is recorded after
 * the fetch await), this is a no-op and the returned row reflects the
 * current state.
 *
 * @param db - Drizzle handle.
 * @param id - run id (the wire UUID, stored in the `run_id` column).
 * @param workerId - the worker that accepted the dispatch.
 * @returns the row's current state. `status` may be `'dispatched'`
 * (transition succeeded) or any other value (transition rejected by
 * guard; row already moved on).
 */
export function markRunDispatched(db: Db, id: string, workerId: string): Run {
  const now = new Date().toISOString();
  db.update(runs)
    .set({ status: "dispatched", workerId, dispatchedAt: now })
    .where(and(eq(runs.runId, id), eq(runs.status, "pending")))
    .run();
  const run = getRun(db, id);
  if (!run) {
    throw new Error(`update returned no row for run_id ${id}`);
  }
  return run;
}

/**
 * Flip a run's status to `'complete'`. Used by the worker's ack callback
 * when the job succeeded. Optional `error` carries a warning-level message
 * that doesn't fail the run (rare; reserved for partial-success cases).
 *
 * Guarded against overwriting a terminal state: only fires when current
 * status is `pending` or `dispatched`. If the run already settled
 * (`complete`/`failed`), this is a no-op and the returned row reflects
 * the existing terminal state.
 *
 * @param db - Drizzle handle.
 * @param id - run id.
 * @param error - optional warning-level message; null in DB if omitted.
 * @returns the row's current state. `status` may be `'complete'`
 * (transition succeeded) or `'complete'`/`'failed'` from a prior call
 * (transition rejected by guard).
 */
export function markRunComplete(db: Db, id: string, error?: string): Run {
  const now = new Date().toISOString();
  db.update(runs)
    .set({ status: "complete", completedAt: now, error: error ?? null })
    .where(and(eq(runs.runId, id), inArray(runs.status, ["pending", "dispatched"])))
    .run();
  const run = getRun(db, id);
  if (!run) {
    throw new Error(`update returned no row for run_id ${id}`);
  }
  return run;
}

/**
 * Flip a run's status to `'failed'` with a required `error` message. Used
 * both when the worker's ack reports `ok: false` and when the dispatch
 * fetch from the orchestrator throws.
 *
 * Guarded against overwriting a terminal state: only fires when current
 * status is `pending` or `dispatched`. If the run already settled
 * (`complete`/`failed`), this is a no-op — important when the orchestrator
 * is in the catch branch of a dispatch fetch that errored *after* the
 * worker successfully completed and called back.
 *
 * @param db - Drizzle handle.
 * @param id - run id.
 * @param error - human-readable failure reason.
 * @returns the row's current state. `status` may be `'failed'`
 * (transition succeeded) or `'complete'` (worker beat us to it).
 */
export function markRunFailed(db: Db, id: string, error: string): Run {
  const now = new Date().toISOString();
  db.update(runs)
    .set({ status: "failed", completedAt: now, error })
    .where(and(eq(runs.runId, id), inArray(runs.status, ["pending", "dispatched"])))
    .run();
  const run = getRun(db, id);
  if (!run) {
    throw new Error(`update returned no row for run_id ${id}`);
  }
  return run;
}

/**
 * List all runs, newest-first by `created_at`.
 *
 * @param db - Drizzle handle.
 * @returns array of validated `Run` records.
 */
export function listRuns(db: Db): Run[] {
  return db
    .select()
    .from(runs)
    .orderBy(desc(runs.createdAt))
    .all()
    .map((row) => rowToRun(row));
}

/**
 * Look up a single run by its wire UUID.
 *
 * @param db - Drizzle handle.
 * @param id - run id (the wire UUID, stored in the `run_id` column).
 * @returns the `Run` record, or undefined if no row matches.
 */
export function getRun(db: Db, id: string): Run | undefined {
  const row = db.select().from(runs).where(eq(runs.runId, id)).get();
  if (!row) {
    return undefined;
  }
  return rowToRun(row);
}

/**
 * Bulk-mark `dispatched` runs as `failed` if their `dispatched_at` predates
 * `threshold`. Used by the orchestrator's periodic sweep to catch workers
 * that accepted a job but never posted `/runs/:id/complete`.
 *
 * @param db - Drizzle handle.
 * @param threshold - ISO 8601 timestamp; rows with `dispatchedAt < threshold` are eligible.
 * @param error - human-readable failure reason written to each row's `error` column.
 * @returns count of rows newly flipped to `'failed'`.
 */
export function markRunsTimedOutSince(db: Db, threshold: string, error: string): number {
  const now = new Date().toISOString();
  const result = db
    .update(runs)
    .set({ status: "failed", completedAt: now, error })
    .where(and(eq(runs.status, "dispatched"), lt(runs.dispatchedAt, threshold)))
    .run();
  return Number(result.changes);
}
