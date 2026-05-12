// Wire-shape Zod schemas. These describe what flows over HTTP / IPC, and
// they intentionally mirror the previous hand-authored schemas in
// `@felafel/shared` byte-for-byte: same field names (`id` for the worker /
// run UUID, not `workerId` / `runId`), same optional/required, same
// refinements (`z.uuid()`, `z.url()`, `z.string().min(1)`, `z.iso.datetime()`).
//
// What @felafel/contracts adds beyond the previous hand-authored schemas:
// **enum unions are sourced from the Drizzle column definitions in
// `./schema.ts`** (e.g. `WorkerStatusSchema = z.enum(workers.status.enumValues)`).
// Adding a new state value to `schema.ts` flows through here automatically;
// the wire and the DB stay in sync without duplicate enum literals.
//
// The DB↔wire field rename (`worker_id` ↔ `id`) is NOT done in the schema.
// It happens in `@felafel/db/conversions.ts` at the row → wire boundary,
// because doing it via `.transform()` would change the schema's input shape
// — breaking every existing caller that already passes `{id, ...}`.
//
// Schemas not tied to a table — `JobAssignmentSchema` (orchestrator →
// worker dispatch) and `RunCompleteSchema` (worker ack) — are hand-authored
// since there's nothing for drizzle-zod to generate from.

import { z } from "zod";

import { runs, workers } from "@felafel/contracts/schema";

// ---------- Worker ----------

/**
 * Operating systems the worker daemon supports — sourced from the Drizzle
 * `workers.os` column enum so adding a new value in `schema.ts` flows
 * through here automatically.
 */
export const WorkerOsSchema = z.enum(workers.os.enumValues);
export type WorkerOs = z.infer<typeof WorkerOsSchema>;

/**
 * CPU architectures the worker daemon supports — sourced from the Drizzle
 * `workers.arch` column enum.
 */
export const WorkerArchSchema = z.enum(workers.arch.enumValues);
export type WorkerArch = z.infer<typeof WorkerArchSchema>;

/**
 * Server-managed worker liveness state. Sourced from the Drizzle
 * `workers.status` column enum. Set by the orchestrator's periodic sweep,
 * never sent on registration. `"stale"` means `lastSeenAt` is older than
 * the heartbeat-miss threshold; the worker re-registering flips it back.
 */
export const WorkerStatusSchema = z.enum(workers.status.enumValues);
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

/**
 * Worker registration payload — what the worker daemon POSTs to `/workers`.
 *
 * `id` is the daemon's persisted UUID. The orchestrator stores it in the
 * `worker_id` column (the `@felafel/db` conversion layer does the rename);
 * the wire never sees the DB-internal integer PK.
 */
export const WorkerRegistrationSchema = z.object({
  id: z.uuid(),
  hostname: z.string().min(1),
  tailscaleName: z.string().optional(),
  os: WorkerOsSchema.optional(),
  arch: WorkerArchSchema.optional(),
  version: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  // Where the orchestrator dials to dispatch jobs to this worker. Required —
  // every worker must be reachable. Workers that only want to be observed
  // (no dispatch) aren't a thing in v0.
  controlPlaneUrl: z.url(),
});
export type WorkerRegistration = z.infer<typeof WorkerRegistrationSchema>;

/**
 * Full worker shape — registration fields plus server-managed liveness.
 * Returned by `GET /workers` and echoed back by `POST /workers` after the
 * upsert.
 */
export const WorkerSchema = WorkerRegistrationSchema.extend({
  status: WorkerStatusSchema,
  registeredAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
});
export type Worker = z.infer<typeof WorkerSchema>;

// ---------- Run ----------

/**
 * Run lifecycle states: `pending` → `dispatched` → (`complete` | `failed`).
 * Sourced from the Drizzle `runs.status` column.
 *
 * `pending` is the brief window between INSERT and the orchestrator's
 * outbound dispatch call returning. Stuck `dispatched` runs flip to
 * `failed` via the periodic sweep.
 */
export const RunStatusSchema = z.enum(runs.status.enumValues);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * Full run shape — returned by `GET /runs` and `GET /runs/:id`. The DB row's
 * `run_id` column maps to the wire's `id` (rename happens in
 * `@felafel/db/conversions.ts`, not here).
 */
export const RunSchema = z.object({
  id: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
  status: RunStatusSchema,
  workerId: z.uuid().optional(),
  error: z.string().optional(),
  createdAt: z.iso.datetime(),
  dispatchedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
});
export type Run = z.infer<typeof RunSchema>;

// ---------- Hand-authored (no table to derive from) ----------

/**
 * Orchestrator → worker dispatch payload. Posted to the worker's
 * `controlPlaneUrl + /jobs/run`. The worker returns 202 immediately, then
 * posts back to `${ORCHESTRATOR_URL}/runs/:id/complete` when done.
 */
export const JobAssignmentSchema = z.object({
  runId: z.uuid(),
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
