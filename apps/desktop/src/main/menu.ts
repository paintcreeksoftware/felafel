// Electron application menu wiring for the desktop app. Currently
// contains the macOS minimal-menu builder; `applyMainAppMenu` (the
// public driver that decides whether to install the menu) lands in
// the next commit on this branch.
//
// Extracted out of desktop.ts so the desktop file stays focused on
// composition and lifecycle wiring.
import { app, Menu } from "electron";

/**
 * Build the minimum-viable macOS application menu: app submenu (about,
 * hide, quit) + Edit submenu (the Edit roles are what wires Cmd-C/V/X
 * and Cmd-A into focused inputs on macOS — without them, copy/paste
 * silently stops working in form fields).
 *
 * @returns the assembled `Menu` ready to pass to `setApplicationMenu`
 */
export function buildMinimalMacMenu(): Menu {
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
