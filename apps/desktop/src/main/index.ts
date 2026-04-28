// Electron main process — the Node program that owns the application lifecycle,
// the window, and child processes (PocketBase). It runs in a separate OS
// process from the renderer, communicates with it over IPC, and has
// unrestricted Node access (filesystem, child_process, etc).
//
// Lifecycle: app.whenReady → register IPC handlers → start PocketBase sidecar →
// create BrowserWindow with preload attached. On `before-quit` we shut
// PocketBase down cleanly so it doesn't leak as an orphan process.
import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Channels, type PocketBaseStatus } from "@felafel/shared";
import { getCredentials, startPocketBase, stopPocketBase } from "./pocketbase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let pocketBaseUrl: string | null = null;

// Push a status update to every open window. Cached `pocketBaseUrl` is what the
// IPC handler returns to the renderer when asked.
function broadcastStatus(status: PocketBaseStatus) {
  if (status.kind === "ready") {
    pocketBaseUrl = status.url;
  }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(Channels.PocketBaseStatus, status);
  }
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
  ipcMain.handle(Channels.PocketBaseUrl, () => pocketBaseUrl);
  ipcMain.handle(Channels.PocketBaseCredentials, () => getCredentials());

  broadcastStatus({ kind: "starting" });
  try {
    const url = await startPocketBase();
    broadcastStatus({ kind: "ready", url });
  } catch (err) {
    console.error("[main] startPocketBase failed:", err);
    broadcastStatus({
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }

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

// preventDefault + manual exit lets us await PocketBase shutdown before the
// process actually goes away — otherwise SIGTERM races with `app.exit()`.
app.on("before-quit", async (event) => {
  event.preventDefault();
  await stopPocketBase();
  app.exit(0);
});
