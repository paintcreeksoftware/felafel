// IPC and wire contract surface — the single source of truth for messages
// crossing process boundaries (Electron main↔renderer, orchestrator↔worker).
//
// Schemas tied to a database table live in `@felafel/contracts` (Drizzle
// table → wire-shape Zod, with enum unions sourced from the column
// definitions). This file re-exports them so existing consumers — main,
// preload, renderer, worker daemon — keep importing from `@felafel/shared`
// unchanged. Anything mentioning the wire format goes here (or in
// @felafel/contracts), NOT in main/, preload/, or renderer/ — otherwise
// the three processes drift out of sync silently.

import { WorkerArchSchema, WorkerOsSchema, type WorkerRegistration } from "@felafel/contracts";

export {
  JobAssignmentSchema,
  RunCompleteSchema,
  RunSchema,
  RunStatusSchema,
  WorkerArchSchema,
  WorkerOsSchema,
  WorkerRegistrationSchema,
  WorkerSchema,
  WorkerStatusSchema,
  type JobAssignment,
  type Run,
  type RunComplete,
  type RunStatus,
  type Worker,
  type WorkerArch,
  type WorkerOs,
  type WorkerRegistration,
  type WorkerStatus,
} from "@felafel/contracts";

/**
 * Narrow Node's `process.platform` (a wide union including `freebsd`,
 * `aix`, etc.) to the values `WorkerRegistrationSchema` accepts. Returns
 * undefined on unsupported platforms so the worker registers with `os`
 * omitted rather than failing the whole registration.
 *
 * @returns the matching enum value, or undefined for unsupported platforms
 */
export function osForRegistration(): WorkerRegistration["os"] {
  const result = WorkerOsSchema.safeParse(process.platform);
  return result.success ? result.data : undefined;
}

/**
 * Narrow Node's `process.arch` the same way — see {@link osForRegistration}.
 * Lets the schema be the single source of truth for which arches we accept.
 *
 * @returns the matching enum value, or undefined for unsupported arches
 */
export function archForRegistration(): WorkerRegistration["arch"] {
  const result = WorkerArchSchema.safeParse(process.arch);
  return result.success ? result.data : undefined;
}

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
