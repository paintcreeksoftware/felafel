/**
 * IPv4 loopback. Bind here for services that must not be reachable on
 * the host LAN. Mirrors the same literal duplicated in each app package
 * (worker, orchestrator, desktop) — kept here too so @felafel/tailscale
 * doesn't have to import from any consumer app and create a cycle.
 */
export const LOCALHOST = "127.0.0.1";

/**
 * Cap on stderr / stdout preview length when classifying or logging a
 * failed `tailscale` invocation. 500 chars is enough to fingerprint a
 * failure mode in logs without flooding the renderer's error UI with
 * pages of raw CLI output. Used by both the pure classifiers and the
 * parsers' malformed-JSON fallback path.
 */
export const STDERR_PREVIEW_MAX_LEN = 500;

/**
 * Environment variable names read by @felafel/tailscale. Centralized so
 * a typo at the read site surfaces as a TypeScript error against the
 * keyof literal type, not as a silent undefined.
 */
export const TailscaleEnvVars = {
  /**
   * Path to a fake `tailscale` CLI script for E2E. When set, the
   * manager uses this binary instead of resolving the real `tailscale`
   * via `which`. Lets tests exercise the manager's parsing /
   * classification logic without needing the daemon installed.
   */
  FELAFEL_TAILSCALE_FAKE: "FELAFEL_TAILSCALE_FAKE",
} as const;
