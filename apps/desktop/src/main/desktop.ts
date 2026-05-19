// Top-level desktop main-process owner. Composes the orchestrator +
// Tailscale managers and wires them up to Electron's lifecycle and IPC
// channels.
//
// `DesktopApp` is module-private — only this file knows it exists, and only
// the bottom of `index.ts` calls `startDesktopApp()`. That keeps the
// "instantiated exactly once per process" property without needing a
// formal singleton (private constructor, static accessor). Calling
// `startDesktopApp` twice would construct two instances and double-register
// IPC handlers — don't.
import type { NodeSDK } from "@opentelemetry/sdk-node";
import { app, BrowserWindow, globalShortcut } from "electron";
import type { Logger } from "@felafel/logs";
import { tracedHandle } from "@felafel/shared/traced-ipc";
import {
  Channels,
  type OrchestratorStatus,
  type TailscaleStatus,
} from "@felafel/shared";
import { DesktopEnvVars, Platform } from "@felafel/desktop/main/constants";
import { applyAppIdentity } from "@felafel/desktop/main/identity";
import { applyMainAppMenu } from "@felafel/desktop/main/menu";
import { OrchestratorManager } from "@felafel/desktop/main/orchestrator";
import {
  buildBrowserWindow,
  loadRenderer,
  wireExternalLinkAllowlist,
} from "@felafel/desktop/main/window";
import { TailscaleManager } from "@felafel/tailscale";

/**
 * Top-level desktop main-process owner. Composes the orchestrator +
 * Tailscale managers and wires them up to Electron's lifecycle and IPC
 * channels.
 * @remarks
 * Module-private — instantiated once via {@link startDesktopApp} from
 * `index.ts`. **Not** a formal singleton: there is no `getInstance`
 * accessor, no private constructor, and `startDesktopApp` does not check
 * for an existing instance before constructing. The "exactly once per
 * process" property is held by call-site discipline (the class is
 * non-exported, and `index.ts` invokes the bootstrap exactly once at
 * module load). Naming reflects scope — `Desktop` because this owns the
 * desktop app's main process, not the whole `Felafel` project (which also
 * spans the orchestrator and future worker apps).
 */
interface DesktopAppDeps {
  logger: Logger;
  sdk: NodeSDK;
}

class DesktopApp {
  private mainWindow: BrowserWindow | null = null;
  private orchestratorUrl: string | null = null;
  // Cached status — broadcasts fire before createWindow() so a renderer
  // that mounts after the broadcast (always, in practice) needs a way to
  // recover the latest state on mount. Mirrors orchestratorUrl above but
  // carries the full discriminated union.
  private orchestratorStatus: OrchestratorStatus = { kind: "starting" };
  private readonly logger: Logger;
  private readonly tailscale: TailscaleManager;
  private readonly orchestrator: OrchestratorManager;

  constructor(deps: DesktopAppDeps) {
    this.logger = deps.logger;
    this.tailscale = new TailscaleManager(
      this.logger.child({ component: "tailscale" }),
    );
    this.orchestrator = new OrchestratorManager(
      this.tailscale,
      this.logger.child({ component: "orchestrator" }),
    );
  }

  /**
   * Wire IPC handlers and Electron lifecycle hooks. Idempotent in practice
   * because this is called once per process.
   */
  start(): void {
    applyAppIdentity();
    applyMainAppMenu();
    this.registerIpcHandlers();
    this.registerAppLifecycle();
  }

  /**
   * Register IPC handlers so the renderer can read orchestrator/Tailscale
   * state. Must run before any window opens; safe to register before
   * `app.whenReady`.
   */
  private registerIpcHandlers(): void {
    tracedHandle(Channels.OrchestratorUrl, this.logger, () => this.orchestratorUrl);
    tracedHandle(Channels.OrchestratorStatusGet, this.logger, () => this.orchestratorStatus);

    // Tailscale handlers. ts:status returns the cached value (instant);
    // ts:refresh forces a re-probe AND re-attempts the orchestrator's
    // tailnet-serve setup so a runtime `--operator` change is reflected
    // in the pill (status probe is operator-blind; serve is what the
    // operator setting gates). ts:connect runs `tailscale up` and kicks
    // off a fire-and-forget re-probe so the steady-state status arrives
    // via broadcast even though the Promise resolves with the immediate
    // `up` outcome.
    tracedHandle(Channels.TailscaleStatus, this.logger, () =>
      this.tailscale.getCachedStatus(),
    );
    tracedHandle(Channels.TailscaleRefresh, this.logger, async () => {
      const status = await this.tailscale.probeStatus();
      this.broadcastTailscale(status);
      await this.refreshOrchestratorServeAndBroadcast();
      return status;
    });
    tracedHandle(Channels.TailscaleConnect, this.logger, async (_event, ...args) => {
      const key = typeof args[0] === "string" ? args[0] : undefined;
      const result = await this.tailscale.runUp(key);
      void this.broadcastProbeStatus();
      return result;
    });
  }

  /**
   * Re-probe Tailscale and broadcast the result. Fire-and-forget callers
   * should invoke this via `void` so unhandled rejections still surface.
   */
  private async broadcastProbeStatus(): Promise<void> {
    const status = await this.tailscale.probeStatus();
    this.broadcastTailscale(status);
  }

  /**
   * Re-run the orchestrator's tailnet-serve setup and rebroadcast
   * `OrchestratorStatus` with the fresh degradation. Called from the
   * Tailscale refresh handler so a user who fixes their `--operator`
   * setting (or breaks it) sees the pill update without an orchestrator
   * restart. No-op when the orchestrator isn't in the `ready` state —
   * the broadcast would otherwise replace a `starting`/`error` status
   * with a stale `ready` one.
   */
  private async refreshOrchestratorServeAndBroadcast(): Promise<void> {
    const tailnetServe = await this.orchestrator.refreshTailnetServe();
    if (this.orchestratorStatus.kind !== "ready") {
      return;
    }
    this.broadcastOrchestrator({
      kind: "ready",
      url: this.orchestratorStatus.url,
      ...(tailnetServe ? { degradations: { tailnetServe } } : {}),
    });
  }

  /**
   * Register Electron app lifecycle hooks: `whenReady`, `window-all-closed`,
   * `before-quit`. Coordinates orchestrator startup/shutdown, Tailscale
   * probe, and window creation.
   */
  private registerAppLifecycle(): void {
    void this.bootstrapOnReady();

    // macOS convention: keep the app running when all windows close.
    // Linux/Windows quit immediately (the OS quit-on-close behavior).
    app.on("window-all-closed", () => {
      if (process.platform !== Platform.MACOS) {
        app.quit();
      }
    });

    // preventDefault + manual exit lets us await orchestrator shutdown
    // before the process actually goes away — otherwise SIGTERM races with
    // app.exit().
    app.on("before-quit", (event) => {
      event.preventDefault();
      globalShortcut.unregisterAll();
      // Wrapped to satisfy `@typescript-eslint/no-misused-promises`:
      // Electron's `before-quit` handler is typed as void-returning,
      // so the async body runs detached and we exit explicitly at the
      // end. The `event.preventDefault()` above is what holds the
      // quit open until `app.exit(0)` fires below.
      void (async () => {
      // The handler must reach app.exit(0) no matter what — a thrown
      // error here would leave the preventDefault()'d quit hanging
      // forever. orchestrator.stop() now propagates the (rare) tailscale
      // unpublish failure; this is the right layer to log+continue
      // because exit-cleanup UX is desktop main's concern, not the
      // manager's.
      try {
        await this.orchestrator.stop();
      } catch (error) {
        this.logger.error({ err: error }, "orchestrator.stop.failed");
      }
      app.exit(0);
      })();
    });
  }

  /**
   * `app.whenReady` body, factored out so the registration site can use
   * `await` instead of `.then(async () => {...})`.
   */
  private async bootstrapOnReady(): Promise<void> {
    await app.whenReady();

    // Re-add the DevTools accelerator the default View menu would have
    // provided. Dev-only: a packaged build should not expose DevTools to
    // end users by default.
    if (process.env[DesktopEnvVars.ELECTRON_RENDERER_URL]) {
      globalShortcut.register("CmdOrCtrl+Shift+I", () => {
        BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools();
      });
    }

    this.broadcastOrchestrator({ kind: "starting" });
    try {
      const url = await this.orchestrator.start();
      // Read any tailnet-serve degradation captured during start() and
      // include it in the ready broadcast so the renderer can show a
      // degraded indicator with a remediation hint (e.g.
      // `sudo tailscale set --operator=$USER` for the EACCES case).
      // null when start() ran cleanly.
      const tailnetServe = this.orchestrator.getServeDegradation();
      this.broadcastOrchestrator({
        kind: "ready",
        url,
        ...(tailnetServe ? { degradations: { tailnetServe } } : {}),
      });
    } catch (error) {
      this.logger.error({ err: error }, "orchestrator.start.failed");
      this.broadcastOrchestrator({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    // Best-effort initial Tailscale probe. Fire-and-forget — Tailscale is
    // optional and we don't want a missing binary or unreachable daemon
    // to delay the window opening.
    void this.broadcastProbeStatus();

    await this.createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void this.createWindow();
      }
    });
  }

  /**
   * Create the BrowserWindow and load the renderer (Vite dev server in dev,
   * bundled HTML in packaged builds).
   */
  private async createWindow(): Promise<void> {
    this.mainWindow = buildBrowserWindow();
    wireExternalLinkAllowlist(this.mainWindow);
    await loadRenderer(this.mainWindow);
  }

  /**
   * Cache the orchestrator URL on `ready` and broadcast the status to every
   * open window so the renderer's React state can update.
   * @param status - the new status to publish
   */
  private broadcastOrchestrator(status: OrchestratorStatus): void {
    if (status.kind === "ready") {
      this.orchestratorUrl = status.url;
    }
    // Cache so renderers that mount after this broadcast can still recover
    // the latest state via OrchestratorStatusGet (the broadcast itself
    // goes nowhere if no window is open yet).
    this.orchestratorStatus = status;
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(Channels.OrchestratorStatus, status);
    }
  }

  /**
   * Forward a Tailscale status update to every open window. Returns the
   * status it received so it composes cleanly with `.then()` chains in the
   * IPC handlers.
   * @param status - the status received from the manager
   * @returns the same status (passthrough)
   */
  private broadcastTailscale(status: TailscaleStatus): TailscaleStatus {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(Channels.TailscaleStatus, status);
    }
    return status;
  }
}

/**
 * Bootstrap the desktop main process: `new DesktopApp().start()`.
 *
 * **Not a singleton.** This function does not check for an existing
 * instance; it constructs a new {@link DesktopApp} every time it's
 * called. There is no `getInstance` accessor, no static cache, no
 * "return the running app if one exists" branch.
 *
 * **Call-site discipline:** invoke this exactly once per process,
 * from `index.ts` at module load, and never again. A second call
 * would construct a second `DesktopApp`, which would double-register
 * IPC handlers (Electron throws on duplicates), attach a second set
 * of `app.whenReady` / `before-quit` listeners, and spawn a second
 * orchestrator child. There is no recovery path; the discipline is
 * the safety mechanism.
 *
 * If a future change needs to re-enter this bootstrap (e.g. test
 * harness, hot-reload), introduce an explicit instance guard or
 * `getInstance` accessor at that point — don't paper over a second
 * call with try/catch.
 * @param deps - logger + OTel SDK constructed by `bootstrap` in
 *   `index.ts`; the class owns the logger but doesn't own the SDK
 *   (shutdown wiring lives at the entry point).
 */
export function startDesktopApp(deps: DesktopAppDeps): void {
  new DesktopApp(deps).start();
}

