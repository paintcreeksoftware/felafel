// Electron main process — the Node program that owns the application
// lifecycle, the window, and child processes (the orchestrator service). It
// runs in a separate OS process from the renderer, communicates with it over
// IPC, and has unrestricted Node access (filesystem, child_process, etc).
//
// State is encapsulated in `FelafelApp`, which composes a `TailscaleManager`
// and an `OrchestratorManager` for the corresponding subsystems' state. The
// class isn't exported and is instantiated exactly once at the bottom of
// this file — that one-`new`-call is the singleton, no static-getInstance
// ceremony.
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
import { OrchestratorManager } from "@felafel/desktop/main/orchestrator.js";
import { TailscaleManager } from "@felafel/desktop/main/tailscale.js";

const __dirname = import.meta.dirname;

/**
 * Top-level main-process owner. Composes the orchestrator + Tailscale
 * managers and wires them up to Electron's lifecycle and IPC channels.
 *
 * @remarks
 * Module-private — instantiated once at the bottom of this file. Not a
 * formal singleton (no private constructor / static accessor); the
 * encapsulation comes from being a non-exported class instantiated once
 * per process.
 */
class FelafelApp {
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
        preload: join(__dirname, "../preload/index.mjs"),
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
      await this.mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
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

new FelafelApp().start();
