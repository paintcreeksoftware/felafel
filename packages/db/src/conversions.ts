// Translate between DB row shapes (what Drizzle's `.select()` returns) and
// wire shapes (what `@felafel/contracts` Zod schemas describe).
//
// Two reasons this layer exists rather than embedding the rename in the
// schemas via `.transform()`:
//
// 1. The wire schema's INPUT shape must match what HTTP clients send
//    (`{id, ...}`) — embedding a `workerId → id` transform would change
//    the input shape and break every existing caller.
// 2. JSON-stringified columns (`labels`) need explicit JSON.parse before
//    schema validation; the schema describes the parsed shape.
//
// Each `rowTo*` function is defensive — calling `.parse()` rather than
// `.passthrough()` so DB corruption surfaces as a clear ZodError at the
// boundary rather than propagating bad runtime values.

import { type Run, RunSchema, type Worker, WorkerSchema } from "@felafel/contracts";
import { type runs, type workers } from "@felafel/contracts/schema";

/**
 * Translate a `workers` row (Drizzle-typed) to the wire `Worker` shape.
 *
 * Renames `row.workerId` → `wire.id`, JSON-parses `row.labels`, normalizes
 * nullable columns to `undefined`, and runs the result through `WorkerSchema`
 * for end-to-end validation.
 *
 * @param row - row as returned by `db.select().from(workers).get()`.
 * @returns the validated wire `Worker` object.
 * @throws {ZodError} if any column violates the wire contract (e.g. invalid UUID, malformed labels JSON).
 */
export function rowToWorker(row: typeof workers.$inferSelect): Worker {
  return WorkerSchema.parse({
    id: row.workerId,
    hostname: row.hostname,
    tailscaleName: row.tailscaleName ?? undefined,
    os: row.os ?? undefined,
    arch: row.arch ?? undefined,
    version: row.version ?? undefined,
    labels: row.labels ? (JSON.parse(row.labels) as Record<string, string>) : undefined,
    controlPlaneUrl: row.controlPlaneUrl,
    status: row.status,
    registeredAt: row.registeredAt,
    lastSeenAt: row.lastSeenAt,
  });
}

/**
 * Translate a `runs` row (Drizzle-typed) to the wire `Run` shape.
 *
 * Renames `row.runId` → `wire.id`, JSON-parses `row.payload`, normalizes
 * nullable columns to `undefined`, and runs the result through `RunSchema`.
 *
 * @param row - row as returned by `db.select().from(runs).get()`.
 * @returns the validated wire `Run` object.
 * @throws {ZodError} if any column violates the wire contract (e.g. malformed payload JSON, invalid UUID).
 */
export function rowToRun(row: typeof runs.$inferSelect): Run {
  return RunSchema.parse({
    id: row.runId,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    status: row.status,
    workerId: row.workerId ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    dispatchedAt: row.dispatchedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
  });
}
