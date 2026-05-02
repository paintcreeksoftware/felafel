// IPC contract — the single source of truth for messages crossing the Electron
// process boundary. Main registers handlers keyed by these channel names,
// preload exposes typed wrappers via contextBridge, and the renderer imports
// the types so `window.api` is fully type-checked.
//
// Anything mentioning the wire format goes here, NOT in main/, preload/, or
// renderer/ — otherwise the three processes drift out of sync silently.

import { z } from "zod";

// Orchestrator worker schemas — consumed by both the orchestrator service
// (route validation, OpenAPI generation) and the desktop renderer (typed RPC
// client via hc<AppType>). Server-to-server calls (orchestrator → worker,
// worker → orchestrator) also import these and validate via Schema.parse() at
// the boundary. Defined here so the wire contract has one source of truth.
export const WorkerRegistrationSchema = z.object({
  id: z.string().uuid(),
  hostname: z.string().min(1),
  tailscaleName: z.string().optional(),
  os: z.enum(["linux", "darwin", "win32"]).optional(),
  arch: z.enum(["x64", "arm64"]).optional(),
  version: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  // Where the orchestrator dials to dispatch jobs to this worker. Required —
  // every worker must be reachable. Workers that only want to be observed (no
  // dispatch) aren't a thing in v0.
  controlPlaneUrl: z.string().url(),
});
export type WorkerRegistration = z.infer<typeof WorkerRegistrationSchema>;

/**
 * Narrow Node's `process.platform` (a wide union including `freebsd`,
 * `aix`, etc.) to the values WorkerRegistrationSchema accepts. Returns
 * undefined on unsupported platforms so the worker registers with `os`
 * omitted rather than failing the whole registration.
 *
 * @returns the matching enum value, or undefined for unsupported platforms
 */
export function osForRegistration(): WorkerRegistration["os"] {
  const result = WorkerRegistrationSchema.shape.os.safeParse(process.platform);
  return result.success ? result.data : undefined;
}

/**
 * Narrow Node's `process.arch` the same way — see
 * {@link osForRegistration}. Lets the schema be the single source of
 * truth for which arches we accept.
 *
 * @returns the matching enum value, or undefined for unsupported arches
 */
export function archForRegistration(): WorkerRegistration["arch"] {
  const result = WorkerRegistrationSchema.shape.arch.safeParse(process.arch);
  return result.success ? result.data : undefined;
}

// Server-managed worker liveness state. Set by the orchestrator's periodic
// sweep, never sent on registration. `'stale'` means `last_seen_at` is older
// than the heartbeat-miss threshold; the worker re-registering flips it back.
export const WorkerStatusSchema = z.enum(["active", "stale"]);
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

export const WorkerSchema = WorkerRegistrationSchema.extend({
  status: WorkerStatusSchema,
  registeredAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
});
export type Worker = z.infer<typeof WorkerSchema>;

// Orchestrator → worker dispatch payload. Posted to the worker's
// `controlPlaneUrl` + `/jobs/run`. Worker returns 202 immediately, then posts
// to `${ORCHESTRATOR_URL}/runs/:id/complete` when done.
export const JobAssignmentSchema = z.object({
  runId: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
});
export type JobAssignment = z.infer<typeof JobAssignmentSchema>;

// Worker → orchestrator ack body. `ok: true` flips the run to `'complete'`;
// `ok: false` flips to `'failed'` and surfaces `error` on the Run record.
export const RunCompleteSchema = z.object({
  ok: z.boolean(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});
export type RunComplete = z.infer<typeof RunCompleteSchema>;

// Run lifecycle states. `pending` → `dispatched` → (`complete` | `failed`).
// `pending` is the brief window between INSERT and the orchestrator's outbound
// dispatch call returning. Stuck `dispatched` runs flip to `failed` via sweep.
export const RunStatusSchema = z.enum([
  "pending",
  "dispatched",
  "complete",
  "failed",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunSchema = z.object({
  id: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
  status: RunStatusSchema,
  workerId: z.string().uuid().optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  dispatchedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const Channels = {
  OrchestratorStatus: "orch:status",
  OrchestratorUrl: "orch:url",
  TailscaleStatus: "ts:status",
  TailscaleConnect: "ts:connect",
  TailscaleRefresh: "ts:refresh",
} as const;

export type OrchestratorStatus =
  | { kind: "starting" }
  | { kind: "ready"; url: string }
  | { kind: "error"; message: string };

// Tailscale connectivity state. The main process probes the host's `tailscale`
// CLI and broadcasts whichever variant matches. The renderer's pill is driven
// entirely by `kind` — see TailscalePill component for the visual mapping.
//
// `disconnected.reason` distinguishes "the daemon is up but you're not signed
// in" (needs-login → modal can offer paste-in pre-auth key) from "the daemon
// itself isn't running" (no-daemon → pasting a key won't help; user must
// `systemctl start tailscaled` first).
//
// `error.remediation` carries an actionable one-liner the renderer renders
// verbatim — primarily the `sudo tailscale set --operator=$USER` instruction
// surfaced when the daemon socket returns EACCES.
export type TailscaleStatus =
  | { kind: "unknown" }
  | { kind: "probing" }
  | { kind: "connected"; tailnet: string; selfName: string }
  | { kind: "disconnected"; reason: "needs-login" | "stopped" | "no-daemon" }
  | { kind: "error"; message: string; remediation?: string }
  | { kind: "missing-binary"; path: string | null };

// Result of `tailscale up` — both the no-key (session-resume attempt) and
// keyed (paste-in) flows share this shape. `needs-key` means session resume
// failed with an auth URL, so the renderer should open the paste-in modal.
export type TailscaleConnectResult =
  | { ok: true; kind: "connected" }
  | { ok: false; kind: "needs-key"; authUrl?: string; message: string }
  | { ok: false; kind: "error"; message: string; remediation?: string };

// Shape of `window.api` in the renderer. The preload script is responsible for
// implementing this exactly; this interface is what the renderer trusts.
export interface DesktopApi {
  orchestratorUrl: () => Promise<string>;
  onOrchestratorStatus: (handler: (status: OrchestratorStatus) => void) => () => void;
  tailscaleStatus: () => Promise<TailscaleStatus>;
  tailscaleRefresh: () => Promise<TailscaleStatus>;
  tailscaleConnect: (authkey?: string) => Promise<TailscaleConnectResult>;
  onTailscaleStatus: (handler: (status: TailscaleStatus) => void) => () => void;
}
