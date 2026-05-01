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
// client via hc<AppType>). Defined here so the wire contract has one source
// of truth.
export const WorkerRegistrationSchema = z.object({
  id: z.string().uuid(),
  hostname: z.string().min(1),
  tailscaleName: z.string().optional(),
  os: z.enum(["linux", "darwin", "win32"]).optional(),
  arch: z.enum(["x64", "arm64"]).optional(),
  version: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
});
export type WorkerRegistration = z.infer<typeof WorkerRegistrationSchema>;

export const WorkerSchema = WorkerRegistrationSchema.extend({
  registeredAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
});
export type Worker = z.infer<typeof WorkerSchema>;

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
