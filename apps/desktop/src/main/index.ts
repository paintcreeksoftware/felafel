// Electron main process — the Node program that owns the application lifecycle,
// the window, and child processes (the orchestrator service). It runs in a
// separate OS process from the renderer, communicates with it over IPC, and
// has unrestricted Node access (filesystem, child_process, etc).
//
// State is wrapped in a singleton class rather than module-level `let`s. The
// runtime is still a single-instance process — there's exactly one
// FelafelApp.getInstance() — but the encapsulation makes the lifecycle and
// IPC wiring read top-down as methods on one object, and shifts state out of
// module scope where it can't be tested or reasoned about cleanly.
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "pathe";
import { Channels, type OrchestratorStatus, type TailscaleStatus } from "@felafel/shared";
import { startOrchestrator, stopOrchestrator } from "@felafel/desktop/main/orchestrator.js";
import {
  getCachedStatus as getCachedTailscaleStatus,
  probeStatus as probeTailscaleStatus,
  runUp as runTailscaleUp,
} from "@felafel/desktop/main/tailscale.js";

const __dirname = import.meta.dirname;

class FelafelApp {
  private static instance: FelafelApp | null = null;
  private mainWindow: BrowserWindow | null = null;
  private orchestratorUrl: string | null = null;

  private constructor() {
    // private — use FelafelApp.getInstance()
  }

  static getInstance(): FelafelApp {
    if (!FelafelApp.instance) {
      FelafelApp.instance = new FelafelApp();
    }
    return FelafelApp.instance;
  }

  start(): void {
    this.registerIpcHandlers();
    this.registerAppLifecycle();
  }

  private registerIpcHandlers(): void {
    // IPC handlers must be in place before any window opens, otherwise early
    // renderer calls return undefined. Safe to register before app.whenReady.
    ipcMain.handle(Channels.OrchestratorUrl, () => this.orchestratorUrl);

    // Tailscale handlers. ts:status returns the cached value (instant);
    // ts:refresh forces a re-probe and broadcasts. ts:connect runs
    // `tailscale up` and kicks off a fire-and-forget re-probe so the
    // steady-state status arrives via broadcast even though the Promise
    // resolves with the immediate `up` outcome.
    ipcMain.handle(Channels.TailscaleStatus, () => getCachedTailscaleStatus());
    ipcMain.handle(Channels.TailscaleRefresh, () =>
      probeTailscaleStatus().then((s) => this.broadcastTailscale(s)),
    );
    ipcMain.handle(Channels.TailscaleConnect, async (_event, key?: string) => {
      const result = await runTailscaleUp(key);
      void probeTailscaleStatus().then((s) => this.broadcastTailscale(s));
      return result;
    });
  }

  private registerAppLifecycle(): void {
    void app.whenReady().then(async () => {
      this.broadcastOrchestrator({ kind: "starting" });
      try {
        const url = await startOrchestrator();
        this.broadcastOrchestrator({ kind: "ready", url });
      } catch (error) {
        console.error("[main] startOrchestrator failed:", error);
        this.broadcastOrchestrator({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      // Best-effort initial Tailscale probe. Fire-and-forget — Tailscale is
      // optional and we don't want a missing binary or unreachable daemon to
      // delay the window opening.
      void probeTailscaleStatus().then((s) => this.broadcastTailscale(s));

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
      if (process.platform !== "darwin") {
        app.quit();
      }
    });

    // preventDefault + manual exit lets us await orchestrator shutdown before
    // the process actually goes away — otherwise SIGTERM races with
    // app.exit().
    app.on("before-quit", async (event) => {
      event.preventDefault();
      await stopOrchestrator();
      app.exit(0);
    });
  }

  private async createWindow(): Promise<void> {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        // The preload script runs with Node access in the renderer's context.
        // It's the ONLY way the renderer can talk to main without Electron
        // exposing dangerous APIs to web content. `.mjs` because electron-vite
        // emits ESM preload bundles.
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

    if (process.env.ELECTRON_RENDERER_URL) {
      // Dev: load Vite's HTTP dev server so HMR works.
      await this.mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
      this.mainWindow.webContents.openDevTools({ mode: "detach" });
    } else {
      // Production: load the bundled renderer from disk.
      await this.mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
    }
  }

  private broadcastOrchestrator(status: OrchestratorStatus): void {
    if (status.kind === "ready") {
      this.orchestratorUrl = status.url;
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(Channels.OrchestratorStatus, status);
    }
  }

  private broadcastTailscale(status: TailscaleStatus): TailscaleStatus {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(Channels.TailscaleStatus, status);
    }
    return status;
  }
}

FelafelApp.getInstance().start();
