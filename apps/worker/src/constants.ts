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
  /** Bind hostname. Defaults to {@link Defaults.HOST} (loopback). */
  HOST: "WORKER_HOST",
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

/** HTTP status codes used by the worker's routes. */
export const HttpStatus = {
  /**
   * Job accepted, will run asynchronously. Worker returns this from
   * `POST /jobs/run` then posts to the orchestrator's
   * `POST /runs/:id/complete` once finished.
   */
  ACCEPTED: 202,
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
