// Wire-shape Zod schemas. Schemas tied to a DB table are derived from
// `./schema.ts` via drizzle-zod, then layered with validation refinements
// (`.uuid()`, `.url()`, `.min(1)`, `.datetime()`) the raw `text` columns
// can't express, `.pick()`'d down to just the wire fields, and `.transform()`'d
// at the end to rename `workerId` / `runId` to the wire's `id` field.
//
// Schemas not tied to a DB table — the dispatch payload `JobAssignmentSchema`
// and the worker ack `RunCompleteSchema` — are hand-authored. drizzle-zod has
// nothing to generate from them.
//
// Behaviorally identical to the previous hand-authored schemas in
// `@felafel/shared`; tests/zod.test.ts pins that equivalence.

import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { runs, workers } from "@felafel/contracts/schema";

// ---------- Worker ----------

/**
 * Server-managed worker liveness state. Sourced from the Drizzle column's
 * `enum`, so adding a new state in `schema.ts` flows through here
 * automatically.
 */
export const WorkerStatusSchema = z.enum(workers.status.enumValues);
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

const workerOsSchema = z.enum(workers.os.enumValues);
const workerArchSchema = z.enum(workers.arch.enumValues);

/**
 * Worker registration payload — what the worker daemon POSTs to `/workers`.
 *
 * `id` is the daemon's persisted UUID (stored in the `worker_id` column on
 * the DB side; renamed via the trailing `.transform()`). `controlPlaneUrl`
 * is where the orchestrator dials back to dispatch jobs.
 */
export const WorkerRegistrationSchema = createInsertSchema(workers, {
  workerId: z.string().uuid(),
  hostname: z.string().min(1),
  tailscaleName: z.string().optional(),
  os: workerOsSchema.optional(),
  arch: workerArchSchema.optional(),
  version: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  controlPlaneUrl: z.string().url(),
})
  .pick({
    workerId: true,
    hostname: true,
    tailscaleName: true,
    os: true,
    arch: true,
    version: true,
    labels: true,
    controlPlaneUrl: true,
  })
  .transform(({ workerId, ...rest }) => ({ id: workerId, ...rest }));
export type WorkerRegistration = z.infer<typeof WorkerRegistrationSchema>;

/**
 * Full worker shape — registration fields plus server-managed liveness.
 *
 * Returned by `GET /workers` and echoed back by `POST /workers` after the
 * upsert. `status` flips between `"active"` and `"stale"` based on the
 * heartbeat sweep; `registeredAt` is set on first registration and never
 * mutated; `lastSeenAt` is bumped on every heartbeat.
 */
export const WorkerSchema = createSelectSchema(workers, {
  workerId: z.string().uuid(),
  hostname: z.string().min(1),
  tailscaleName: z.string().optional(),
  os: workerOsSchema.optional(),
  arch: workerArchSchema.optional(),
  version: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  controlPlaneUrl: z.string().url(),
  status: WorkerStatusSchema,
  registeredAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
})
  .pick({
    workerId: true,
    hostname: true,
    tailscaleName: true,
    os: true,
    arch: true,
    version: true,
    labels: true,
    controlPlaneUrl: true,
    status: true,
    registeredAt: true,
    lastSeenAt: true,
  })
  .transform(({ workerId, ...rest }) => ({ id: workerId, ...rest }));
export type Worker = z.infer<typeof WorkerSchema>;

// ---------- Run ----------

/**
 * Run lifecycle states: `pending` → `dispatched` → (`complete` | `failed`).
 * Sourced from the Drizzle `runs.status` column.
 */
export const RunStatusSchema = z.enum(runs.status.enumValues);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * Full run shape — returned by `GET /runs` and `GET /runs/:id`. Same row vs
 * wire identity story as `Worker`: the DB row's `runId` becomes the wire's
 * `id` via the trailing `.transform()`.
 */
export const RunSchema = createSelectSchema(runs, {
  runId: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
  status: RunStatusSchema,
  workerId: z.string().uuid().optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  dispatchedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
})
  .pick({
    runId: true,
    payload: true,
    status: true,
    workerId: true,
    error: true,
    createdAt: true,
    dispatchedAt: true,
    completedAt: true,
  })
  .transform(({ runId, ...rest }) => ({ id: runId, ...rest }));
export type Run = z.infer<typeof RunSchema>;

// ---------- Hand-authored (no table to derive from) ----------

/**
 * Orchestrator → worker dispatch payload. Posted to the worker's
 * `controlPlaneUrl + /jobs/run`. The worker returns 202 immediately, then
 * posts back to `${ORCHESTRATOR_URL}/runs/:id/complete` when done.
 */
export const JobAssignmentSchema = z.object({
  runId: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
});
export type JobAssignment = z.infer<typeof JobAssignmentSchema>;

/**
 * Worker → orchestrator ack body. `ok: true` flips the run to `"complete"`;
 * `ok: false` flips to `"failed"` and surfaces `error` on the Run record.
 */
export const RunCompleteSchema = z.object({
  ok: z.boolean(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});
export type RunComplete = z.infer<typeof RunCompleteSchema>;
