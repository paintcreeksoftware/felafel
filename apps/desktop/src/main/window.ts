// Main BrowserWindow lifecycle helpers. Functions in this file are
// added one at a time as desktop.ts's createWindow is decomposed
// (PAI-140). The current file holds just the renderer-loading step;
// the window construction + external-link wiring + orchestrator land
// in subsequent commits on this branch.
import { BrowserWindow, shell } from "electron";
import { join } from "pathe";
import iconPath from "../../build/icon.png?asset";
import { BRAND_NAME, DesktopEnvVars, WindowSize } from "@felafel/desktop/main/constants";

const moduleDir = import.meta.dirname;

/**
 * Construct the main BrowserWindow with Felafel's canonical config:
 * the OS-visible title set pre-paint, the Linux icon hint, the preload
 * script path, and the renderer-isolation flags.
 * @returns the constructed (but not-yet-loaded) BrowserWindow
 */
export function buildBrowserWindow(): BrowserWindow {
  return new BrowserWindow({
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
}

/**
 * Install an https-only allowlist for `window.open` / target=_blank links:
 * external https URLs hand off to the OS default browser, anything else is
 * denied. Prevents a malicious renderer from opening `file://` or
 * `javascript:` URLs in a new Electron window.
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
 * @param win - the window to load into
 */
export async function loadRenderer(win: BrowserWindow): Promise<void> {
  const rendererUrl = process.env[DesktopEnvVars.ELECTRON_RENDERER_URL];
  await (rendererUrl
    ? win.loadURL(rendererUrl)
    : win.loadFile(join(moduleDir, "../renderer/index.html")));
}
