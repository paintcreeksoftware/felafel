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
} as const;

/** Tag emitted in `ELECTRON_RUN_AS_NODE` so a packaged build's spawned child runs as Node. */
export const ELECTRON_RUN_AS_NODE = "ELECTRON_RUN_AS_NODE";

/** Random-port range the spawned orchestrator binds within (inclusive). */
export const OrchestratorPortRange = {
  LOW: 9090,
  HIGH: 9190,
} as const;

/** Default BrowserWindow dimensions. */
export const WindowSize = {
  WIDTH: 1200,
  HEIGHT: 800,
} as const;
