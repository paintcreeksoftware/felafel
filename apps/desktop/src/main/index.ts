// Electron main process — the Node program that owns the application lifecycle,
// the window, and child processes (the orchestrator service). It runs in a
// separate OS process from the renderer, communicates with it over IPC, and
// has unrestricted Node access (filesystem, child_process, etc).
//
// Lifecycle: app.whenReady → register IPC handlers → start orchestrator sidecar
// → create BrowserWindow with preload attached. On `before-quit` we shut the
// orchestrator down cleanly so it doesn't leak as an orphan process.
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Channels, type OrchestratorStatus, type TailscaleStatus } from "@felafel/shared";
import { startOrchestrator, stopOrchestrator } from "./orchestrator.js";
import {
  getCachedStatus as getCachedTailscaleStatus,
  probeStatus as probeTailscaleStatus,
  runUp as runTailscaleUp,
} from "./tailscale.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let orchestratorUrl: string | null = null;

function broadcastOrchestrator(status: OrchestratorStatus) {
  if (status.kind === "ready") {
    orchestratorUrl = status.url;
  }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(Channels.OrchestratorStatus, status);
  }
}

// Tailscale status broadcast — same pattern as broadcastStatus, returns the
// status it received so it composes cleanly with .then() chains in the
// IPC handlers below.
function broadcastTailscale(status: TailscaleStatus): TailscaleStatus {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(Channels.TailscaleStatus, status);
  }
  return status;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
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
  // Electron window. Allow-list https only so a malicious renderer can't open
  // file:// or javascript: URLs.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    // Dev: load Vite's HTTP dev server so HMR works.
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // Production: load the bundled renderer from disk.
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  // IPC handlers — must be registered before any window opens, otherwise early
  // renderer calls return undefined.
  ipcMain.handle(Channels.OrchestratorUrl, () => orchestratorUrl);

  // Tailscale handlers. ts:status returns the cached value (instant); ts:refresh
  // forces a re-probe and broadcasts. ts:connect runs `tailscale up` and kicks
  // off a fire-and-forget re-probe so the steady-state status arrives via
  // broadcast even though the Promise resolves with the immediate `up` outcome.
  ipcMain.handle(Channels.TailscaleStatus, () => getCachedTailscaleStatus());
  ipcMain.handle(Channels.TailscaleRefresh, () =>
    probeTailscaleStatus().then(broadcastTailscale),
  );
  ipcMain.handle(Channels.TailscaleConnect, async (_event, key?: string) => {
    const result = await runTailscaleUp(key);
    void probeTailscaleStatus().then(broadcastTailscale);
    return result;
  });

  broadcastOrchestrator({ kind: "starting" });
  try {
    const url = await startOrchestrator();
    broadcastOrchestrator({ kind: "ready", url });
  } catch (err) {
    console.error("[main] startOrchestrator failed:", err);
    broadcastOrchestrator({
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Best-effort initial Tailscale probe. Fire-and-forget — Tailscale is
  // optional and we don't want a missing binary or unreachable daemon to
  // delay the window opening.
  void probeTailscaleStatus().then(broadcastTailscale);

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

// macOS convention: keep the app running when all windows close. Linux/ Windows
// quit immediately (the OS quit-on-close behavior).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// preventDefault + manual exit lets us await orchestrator shutdown before the
// process actually goes away — otherwise SIGTERM races with `app.exit()`.
app.on("before-quit", async (event) => {
  event.preventDefault();
  await stopOrchestrator();
  app.exit(0);
});
