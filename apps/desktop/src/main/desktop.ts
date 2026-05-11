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
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, shell } from "electron";
import { join } from "pathe";
import {
  Channels,
  type OrchestratorStatus,
  type TailscaleStatus,
} from "@felafel/shared";
import iconPath from "../../build/icon.png?asset";
import {
  BRAND_NAME,
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
  // Cached status — broadcasts fire before createWindow() so a renderer
  // that mounts after the broadcast (always, in practice) needs a way to
  // recover the latest state on mount. Mirrors orchestratorUrl above but
  // carries the full discriminated union.
  private orchestratorStatus: OrchestratorStatus = { kind: "starting" };
  private readonly tailscale = new TailscaleManager();
  private readonly orchestrator = new OrchestratorManager(this.tailscale);

  /**
   * Wire IPC handlers and Electron lifecycle hooks. Idempotent in practice
   * because this is called once per process.
   */
  start(): void {
    this.applyAppIdentity();
    this.removeDefaultMenu();
    this.registerIpcHandlers();
    this.registerAppLifecycle();
  }

  /**
   * Override Electron's defaults so the running process identifies itself
   * as "Felafel" instead of "Electron".
   *
   * @remarks
   * Without these calls, the dev-mode window inherits the Electron
   * binary's identity:
   *
   * - `app.getName()` returns "electron" (from the executable name),
   *   which leaks into the macOS application menu and the userData
   *   directory name.
   * - On Linux, the X11/Wayland `WM_CLASS` defaults to `Electron`, which
   *   GNOME-derived shells (including Bluefin DX) read for the dock
   *   tooltip and icon-theme lookup. `--class` is a Chromium command-
   *   line flag forwarded by Electron; it must be appended before
   *   `app.whenReady` for Chromium to pick it up.
   *
   * Packaged builds get the same identity through electron-builder's
   * `productName` + the generated `.desktop` file, but calling both
   * APIs again is idempotent.
   */
  private applyAppIdentity(): void {
    app.setName(BRAND_NAME);
    if (process.platform === Platform.LINUX) {
      app.commandLine.appendSwitch("class", BRAND_NAME);
    }
  }

  /**
   * Strip electron-vite's stock menu bar. On Linux/Windows the menu is
   * removed entirely; on macOS we keep a minimal application menu so
   * standard text-input shortcuts (Cmd-C/V, Cmd-Q) keep working — passing
   * `null` on macOS leaves a degraded built-in that's worse than a small
   * custom one.
   */
  private removeDefaultMenu(): void {
    if (process.platform === Platform.MACOS) {
      Menu.setApplicationMenu(this.buildMinimalMacMenu());
    } else {
      Menu.setApplicationMenu(null);
    }
  }

  /**
   * Build the minimum-viable macOS application menu: app submenu (about,
   * hide, quit) + Edit submenu (the Edit roles are what wires Cmd-C/V/X
   * and Cmd-A into focused inputs on macOS — without them, copy/paste
   * silently stops working in form fields).
   *
   * @returns the assembled `Menu` ready to pass to `setApplicationMenu`
   */
  private buildMinimalMacMenu(): Menu {
    return Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
    ]);
  }

  /**
   * Register IPC handlers so the renderer can read orchestrator/Tailscale
   * state. Must run before any window opens; safe to register before
   * `app.whenReady`.
   */
  private registerIpcHandlers(): void {
    ipcMain.handle(Channels.OrchestratorUrl, () => this.orchestratorUrl);
    ipcMain.handle(Channels.OrchestratorStatusGet, () => this.orchestratorStatus);

    // Tailscale handlers. ts:status returns the cached value (instant);
    // ts:refresh forces a re-probe and broadcasts. ts:connect runs
    // `tailscale up` and kicks off a fire-and-forget re-probe so the
    // steady-state status arrives via broadcast even though the Promise
    // resolves with the immediate `up` outcome.
    ipcMain.handle(Channels.TailscaleStatus, () => this.tailscale.getCachedStatus());
    ipcMain.handle(Channels.TailscaleRefresh, async () => {
      const status = await this.tailscale.probeStatus();
      return this.broadcastTailscale(status);
    });
    ipcMain.handle(Channels.TailscaleConnect, async (_event, key?: string) => {
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
    app.on("before-quit", async (event) => {
      event.preventDefault();
      globalShortcut.unregisterAll();
      // The handler must reach app.exit(0) no matter what — a thrown
      // error here would leave the preventDefault()'d quit hanging
      // forever. orchestrator.stop() now propagates the (rare) tailscale
      // unpublish failure; this is the right layer to log+continue
      // because exit-cleanup UX is desktop main's concern, not the
      // manager's.
      try {
        await this.orchestrator.stop();
      } catch (error) {
        console.error("[main] orchestrator.stop failed:", error);
      }
      app.exit(0);
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
      console.error("[main] orchestrator.start failed:", error);
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
    this.mainWindow = new BrowserWindow({
      width: WindowSize.WIDTH,
      height: WindowSize.HEIGHT,
      // Title set here (not just in the renderer's <title>) so the OS
      // sees "Felafel" before the renderer loads — matters for the
      // initial window-decoration label and for screen-reader / a11y
      // tools that read the window title pre-paint.
      title: BRAND_NAME,
      // Linux taskbar/dock icon hint. macOS ignores this (uses the .icns
      // from electron-builder); Windows ignores it for the taskbar but
      // uses it for the window's titlebar icon.
      icon: iconPath,
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

    // Dev (rendererUrl set): load Vite's HTTP dev server so HMR works.
    // Production: load the bundled renderer from disk.
    const rendererUrl = process.env[DesktopEnvVars.ELECTRON_RENDERER_URL];
    await (rendererUrl
      ? this.mainWindow.loadURL(rendererUrl)
      : this.mainWindow.loadFile(join(moduleDir, "../renderer/index.html")));
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
