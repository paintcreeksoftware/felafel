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
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "pathe";
import {
  Channels,
  type OrchestratorStatus,
  type TailscaleStatus,
} from "@felafel/shared";
import {
  DesktopEnvVars,
  Platform,
  WindowSize,
} from "@felafel/desktop/main/constants";
import { OrchestratorManager } from "@felafel/desktop/main/orchestrator";
import { TailscaleManager } from "@felafel/desktop/main/tailscale";

const moduleDir = import.meta.dirname;

/**
 * Top-level desktop main-process owner. Composes the orchestrator +
 * Tailscale managers and wires them up to Electron's lifecycle and IPC
 * channels.
 *
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
class DesktopApp {
  private mainWindow: BrowserWindow | null = null;
  private orchestratorUrl: string | null = null;
  private readonly orchestrator = new OrchestratorManager();
  private readonly tailscale = new TailscaleManager();

  /**
   * Wire IPC handlers and Electron lifecycle hooks. Idempotent in practice
   * because this is called once per process.
   */
  start(): void {
    this.registerIpcHandlers();
    this.registerAppLifecycle();
  }

  /**
   * Register IPC handlers so the renderer can read orchestrator/Tailscale
   * state. Must run before any window opens; safe to register before
   * `app.whenReady`.
   */
  private registerIpcHandlers(): void {
    ipcMain.handle(Channels.OrchestratorUrl, () => this.orchestratorUrl);

    // Tailscale handlers. ts:status returns the cached value (instant);
    // ts:refresh forces a re-probe and broadcasts. ts:connect runs
    // `tailscale up` and kicks off a fire-and-forget re-probe so the
    // steady-state status arrives via broadcast even though the Promise
    // resolves with the immediate `up` outcome.
    ipcMain.handle(Channels.TailscaleStatus, () => this.tailscale.getCachedStatus());
    ipcMain.handle(Channels.TailscaleRefresh, () =>
      this.tailscale.probeStatus().then((s) => this.broadcastTailscale(s)),
    );
    ipcMain.handle(Channels.TailscaleConnect, async (_event, key?: string) => {
      const result = await this.tailscale.runUp(key);
      void this.tailscale.probeStatus().then((s) => this.broadcastTailscale(s));
      return result;
    });
  }

  /**
   * Register Electron app lifecycle hooks: `whenReady`, `window-all-closed`,
   * `before-quit`. Coordinates orchestrator startup/shutdown, Tailscale
   * probe, and window creation.
   */
  private registerAppLifecycle(): void {
    void app.whenReady().then(async () => {
      this.broadcastOrchestrator({ kind: "starting" });
      try {
        const url = await this.orchestrator.start();
        this.broadcastOrchestrator({ kind: "ready", url });
      } catch (error) {
        console.error("[main] orchestrator.start failed:", error);
        this.broadcastOrchestrator({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      // Best-effort initial Tailscale probe. Fire-and-forget — Tailscale is
      // optional and we don't want a missing binary or unreachable daemon
      // to delay the window opening.
      void this.tailscale.probeStatus().then((s) => this.broadcastTailscale(s));

      await this.createWindow();

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void this.createWindow();
        }
      });
    });

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
    app.on("before-quit", async (event) => {
      event.preventDefault();
      await this.orchestrator.stop();
      app.exit(0);
    });
  }

  /**
   * Create the BrowserWindow and load the renderer (Vite dev server in dev,
   * bundled HTML in packaged builds).
   */
  private async createWindow(): Promise<void> {
    this.mainWindow = new BrowserWindow({
      width: WindowSize.WIDTH,
      height: WindowSize.HEIGHT,
      webPreferences: {
        // The preload script runs with Node access in the renderer's
        // context. It's the ONLY way the renderer can talk to main without
        // Electron exposing dangerous APIs to web content. `.mjs` because
        // electron-vite emits ESM preload bundles.
        preload: join(moduleDir, "../preload/index.mjs"),
        sandbox: false,
        contextIsolation: true,
      },
    });

    // Open external links (e.g. the Tailscale install tooltip's
    // <a target="_blank">) in the user's default browser instead of a new
    // Electron window. Allow-list https only so a malicious renderer can't
    // open file:// or javascript: URLs.
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://")) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });

    const rendererUrl = process.env[DesktopEnvVars.ELECTRON_RENDERER_URL];
    if (rendererUrl) {
      // Dev: load Vite's HTTP dev server so HMR works.
      await this.mainWindow.loadURL(rendererUrl);
      this.mainWindow.webContents.openDevTools({ mode: "detach" });
    } else {
      // Production: load the bundled renderer from disk.
      await this.mainWindow.loadFile(join(moduleDir, "../renderer/index.html"));
    }
  }

  /**
   * Cache the orchestrator URL on `ready` and broadcast the status to every
   * open window so the renderer's React state can update.
   *
   * @param status - the new status to publish
   */
  private broadcastOrchestrator(status: OrchestratorStatus): void {
    if (status.kind === "ready") {
      this.orchestratorUrl = status.url;
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(Channels.OrchestratorStatus, status);
    }
  }

  /**
   * Forward a Tailscale status update to every open window. Returns the
   * status it received so it composes cleanly with `.then()` chains in the
   * IPC handlers.
   *
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
 */
export function startDesktopApp(): void {
  new DesktopApp().start();
}
