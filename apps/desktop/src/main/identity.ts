// Process identity for the desktop main. Overrides Electron's defaults
// so the running process advertises itself as "Felafel" instead of
// inheriting the Electron binary's identity (app name "electron",
// `WM_CLASS` "Electron").
//
// Extracted out of desktop.ts so the desktop file stays focused on
// composition + lifecycle wiring, and so the regression test can call
// `applyAppIdentity` directly without standing up a full DesktopApp.
import { app } from "electron";
import { BRAND_NAME, Platform } from "@felafel/desktop/main/constants";

/**
 * Override Electron's defaults so the running process identifies itself
 * as "Felafel" instead of "Electron".
 *
 * @remarks
 * Without these calls, the running process inherits the Electron
 * binary's identity:
 *
 * - `app.getName()` returns "electron" (from the executable name),
 *   which leaks into the macOS application menu and the userData
 *   directory name.
 * - On Linux X11/XWayland, the window's `WM_CLASS` defaults to
 *   `Electron`, which GNOME-derived shells read for the dock tooltip
 *   and icon-theme lookup. `--class` is a Chromium command-line flag
 *   forwarded by Electron; it must be appended before `app.whenReady`
 *   for Chromium to pick it up. On native Wayland this switch is
 *   ignored — `app_id` is derived from the binary name and Electron
 *   exposes no runtime override, so the dev-mode dock/menubar
 *   identity stays "electron" there. Packaged builds get the correct
 *   `app_id` through electron-builder's generated `.desktop` file.
 *
 * Exported as a free function (rather than a private class method) so
 * the regression test can call it directly without standing up a full
 * `DesktopApp` instance.
 */
export function applyAppIdentity(): void {
  app.setName(BRAND_NAME);
  if (process.platform === Platform.LINUX) {
    app.commandLine.appendSwitch("class", BRAND_NAME);
  }
}
