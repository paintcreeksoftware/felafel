// Main BrowserWindow lifecycle helpers. Functions in this file are
// added one at a time as desktop.ts's createWindow is decomposed
// (PAI-140). The current file holds just the renderer-loading step;
// the window construction + external-link wiring + orchestrator land
// in subsequent commits on this branch.
import { type BrowserWindow, shell } from "electron";
import { join } from "pathe";
import { DesktopEnvVars } from "@felafel/desktop/main/constants";

const moduleDir = import.meta.dirname;

/**
 * Install an https-only allowlist for `window.open` / target=_blank links:
 * external https URLs hand off to the OS default browser, anything else is
 * denied. Prevents a malicious renderer from opening `file://` or
 * `javascript:` URLs in a new Electron window.
 *
 * @param win - the window whose openHandler is wired
 */
export function wireExternalLinkAllowlist(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

/**
 * Load the renderer into the given window: the Vite dev-server URL when
 * `ELECTRON_RENDERER_URL` is set (dev mode, HMR), otherwise the bundled
 * renderer HTML on disk (packaged builds).
 *
 * @param win - the window to load into
 */
export async function loadRenderer(win: BrowserWindow): Promise<void> {
  const rendererUrl = process.env[DesktopEnvVars.ELECTRON_RENDERER_URL];
  await (rendererUrl
    ? win.loadURL(rendererUrl)
    : win.loadFile(join(moduleDir, "../renderer/index.html")));
}
