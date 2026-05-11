/**
 * The product's display name. Used wherever the running process needs to
 * identify itself to the OS as something other than "Electron" — the
 * Linux WM_CLASS via the `--class` Chromium switch, `app.setName`, and
 * the BrowserWindow title. Mirrors `productName` in `package.json` (the
 * electron-builder source of truth for packaged installers).
 */
export const BRAND_NAME = "Felafel";

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
   * port to whichever local port the orchestrator picked this run. The
   * default value lives at the consumption site (PR-B's
   * `OrchestratorManager`) — kept out of a desktop-wide `Defaults` object
   * until multiple defaults justify one.
   */
  FELAFEL_ORCHESTRATOR_TAILNET_PORT: "FELAFEL_ORCHESTRATOR_TAILNET_PORT",
  /**
   * Override the orchestrator bundle path resolved by `OrchestratorManager`.
   * Used by E2E tests to point the bundle at a non-existent file so
   * `start()` throws "bundle missing" and the renderer's error-state
   * rendering can be exercised without breaking the real bundle on disk.
   */
  FELAFEL_ORCHESTRATOR_FAKE_BUNDLE: "FELAFEL_ORCHESTRATOR_FAKE_BUNDLE",
} as const;

/** Default BrowserWindow dimensions. */
export const WindowSize = {
  WIDTH: 1200,
  HEIGHT: 800,
} as const;
