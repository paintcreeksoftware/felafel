import { homedir } from "node:os";
import { join } from "pathe";

/** IPv4 loopback. Default bind host for dev. */
export const LOCALHOST = "127.0.0.1";

/**
 * Environment variable names read by the worker at startup. Centralized so
 * renames flow through one place.
 */
export const EnvVars = {
  /** TCP port to bind. Defaults to {@link Defaults.PORT}. */
  PORT: "WORKER_PORT",
  /**
   * Hostname embedded in the advertised `controlPlaneUrl`. When unset, the
   * worker auto-detects via `tailscale ip -4`, falling back to
   * {@link Defaults.HOST} (loopback). Also supplies the default for
   * {@link EnvVars.BIND_HOST} when the bind host isn't specified separately.
   */
  HOST: "WORKER_HOST",
  /**
   * Hostname passed to `serve({ hostname })`. Defaults to whatever
   * {@link EnvVars.HOST} resolves to. Set this independently when the
   * advertised IP is virtual and not bindable on a kernel interface — e.g.,
   * a Tailscale sidecar in userspace mode (`TS_USERSPACE=true`) where the
   * `100.x` Tailnet IP exists only inside `tailscaled` and a direct bind
   * returns `EADDRNOTAVAIL`. In that shape: `WORKER_HOST=100.x`,
   * `WORKER_BIND_HOST=0.0.0.0`, plus a `tailscale serve` mapping in the
   * sidecar that forwards the Tailnet port to the worker's loopback bind.
   */
  BIND_HOST: "WORKER_BIND_HOST",
  /** Orchestrator base URL. Required at runtime; no default. */
  ORCHESTRATOR_URL: "ORCHESTRATOR_URL",
  /** Path to the persistent identity file. Defaults to the XDG-state location. */
  IDENTITY_PATH: "WORKER_IDENTITY_PATH",
  /** Heartbeat tick, in milliseconds. Defaults to {@link Defaults.HEARTBEAT_INTERVAL_MS}. */
  HEARTBEAT_INTERVAL_MS: "WORKER_HEARTBEAT_MS",
} as const;

/** Default values for env vars when not set. */
export const Defaults = {
  PORT: "9091",
  HOST: LOCALHOST,
  HEARTBEAT_INTERVAL_MS: "30000",
} as const;

/**
 * Bounded-retry parameters for the `POST /runs/:id/complete` callback.
 * The orchestrator's stale-run sweep marks `dispatched` runs as `failed`
 * after 5 minutes — these settings keep the total retry window well
 * under that threshold (max ~9.5s) so transient orchestrator
 * unavailability during the callback window doesn't quietly become a
 * "dispatch timeout" on a run that actually succeeded.
 */
export const CompleteCallbackRetry = {
  /** Total attempts including the initial one. */
  MAX_ATTEMPTS: 5,
  /** Initial backoff between retries, in ms. Doubled per attempt. */
  INITIAL_DELAY_MS: 250,
  /** Cap on the backoff between retries, in ms. */
  MAX_DELAY_MS: 4_000,
} as const;

/**
 * Default filesystem path for the worker's identity file. Linux-only — XDG
 * Base Directory Specification is a freedesktop.org spec; the worker is
 * Linux-only for v0 (homelab + container deployments). Override with the
 * {@link EnvVars.IDENTITY_PATH} env var on other OSes.
 *
 * @returns absolute path under `${XDG_STATE_HOME:-$HOME/.local/state}/felafel-worker/identity`
 */
export function defaultIdentityPath(): string {
  const xdgState = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(xdgState, "felafel-worker", "identity");
}
