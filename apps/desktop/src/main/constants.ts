/**
 * Platform identifiers as returned by `process.platform`. Use these in
 * platform-conditional code instead of inline string literals so a typo
 * surfaces as a TS error rather than an always-false branch.
 */
export const Platform = {
  /** macOS / Darwin kernel. */
  MACOS: "darwin",
  /** Linux kernel. */
  LINUX: "linux",
  /** Windows NT kernel. */
  WINDOWS: "win32",
} as const;

/** IPv4 loopback. Bind here for services that must not be reachable on the host LAN. */
export const LOCALHOST = "127.0.0.1";

/**
 * Environment variable names read by the desktop main process. Centralized
 * so a typo like `process.env.FELAFLE_*` surfaces at the read site instead
 * of silently returning undefined.
 */
export const DesktopEnvVars = {
  /**
   * Path to a fake `tailscale` CLI script for E2E. When set, the tailscale
   * manager uses this binary instead of resolving via PATH.
   */
  FELAFEL_TAILSCALE_FAKE: "FELAFEL_TAILSCALE_FAKE",
  /** Vite dev server URL injected by electron-vite during `pnpm dev`. */
  ELECTRON_RENDERER_URL: "ELECTRON_RENDERER_URL",
  /**
   * Stable Tailnet TCP port the AppImage publishes via `tailscale serve` so
   * remote workers have a fixed dial target. The local orchestrator bind
   * stays kernel-assigned ephemeral; Tailscale forwards from this stable
   * port to whichever local port the orchestrator picked this run.
   * Defaults to {@link DesktopDefaults.ORCHESTRATOR_TAILNET_PORT}.
   */
  FELAFEL_ORCHESTRATOR_TAILNET_PORT: "FELAFEL_ORCHESTRATOR_TAILNET_PORT",
} as const;

/** Default values for desktop env vars when not set. */
export const DesktopDefaults = {
  /**
   * Default stable Tailnet port for the orchestrator. 9090 chosen to match
   * the orchestrator's existing default port — when Tailscale is up, a
   * remote worker's `ORCHESTRATOR_URL=http://<desktop-tailnet-name>:9090`
   * lands on the same port number it would in dev.
   */
  ORCHESTRATOR_TAILNET_PORT: 9090,
} as const;

/** Default BrowserWindow dimensions. */
export const WindowSize = {
  WIDTH: 1200,
  HEIGHT: 800,
} as const;
