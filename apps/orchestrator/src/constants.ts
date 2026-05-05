/** IPv4 loopback. Default bind host for embedded mode. */
export const LOCALHOST = "127.0.0.1";

/**
 * Environment variable names read by the orchestrator at startup. Centralized
 * so renames flow through one place.
 */
export const EnvVars = {
  /** TCP port to bind. Defaults to {@link Defaults.PORT}. */
  PORT: "ORCHESTRATOR_PORT",
  /** Bind hostname. Defaults to {@link Defaults.HOST} (loopback). */
  HOST: "ORCHESTRATOR_HOST",
  /** Filesystem path for the SQLite DB and any future persistence. Required. */
  DATA_DIR: "ORCHESTRATOR_DATA_DIR",
} as const;

/** Default values for env vars when not set. */
export const Defaults = {
  PORT: "9090",
  HOST: LOCALHOST,
} as const;
