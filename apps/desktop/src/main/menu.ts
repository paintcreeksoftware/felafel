// Electron application menu wiring for the desktop app. The desktop
// app ships a minimal macOS app menu (so Cmd-C/V/X/A keep working in
// form fields, which requires the Edit role to be registered with the
// OS) and no menu at all on Linux/Windows where the platform doesn't
// expect one.
//
// Extracted out of desktop.ts so the desktop file stays focused on
// composition and lifecycle wiring.
import { app, Menu } from "electron";
import { Platform } from "@felafel/desktop/main/constants";

/**
 * Replace electron-vite's stock menu bar with the right platform default.
 * @remarks
 * On Linux/Windows the menu is removed entirely; on macOS we install a
 * minimal application menu so standard text-input shortcuts (Cmd-C/V,
 * Cmd-Q) keep working. Passing `null` on macOS leaves a degraded
 * built-in that's worse than a small custom one.
 */
export function applyMainAppMenu(): void {
  if (process.platform === Platform.MACOS) {
    Menu.setApplicationMenu(buildMinimalMacMenu());
  } else {
    Menu.setApplicationMenu(null);
  }
}

/**
 * Build the minimum-viable macOS application menu: app submenu (about,
 * hide, quit) + Edit submenu (the Edit roles are what wires Cmd-C/V/X
 * and Cmd-A into focused inputs on macOS — without them, copy/paste
 * silently stops working in form fields).
 * @returns the assembled `Menu` ready to pass to `setApplicationMenu`
 */
function buildMinimalMacMenu(): Menu {
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
