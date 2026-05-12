// Regression guards for `applyMainAppMenu` — the platform-conditional
// menu wiring that keeps Cmd-C/V/X/A working on macOS form fields
// while stripping the menu bar on Linux/Windows where it isn't
// expected. These are call-site assertions; the visible outcome (the
// rendered menu bar) is an integration-level surface that can only
// be verified by running a built app.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Menu } from "electron";
import { applyMainAppMenu } from "@felafel/desktop/main/menu";
import { Platform } from "@felafel/desktop/main/constants";

vi.mock("electron", () => ({
  app: { name: "Felafel" },
  Menu: {
    setApplicationMenu: vi.fn(),
    buildFromTemplate: vi.fn(() => ({})),
  },
}));

describe("applyMainAppMenu", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.mocked(Menu.setApplicationMenu).mockClear();
    vi.mocked(Menu.buildFromTemplate).mockClear();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("installs a built minimal menu on macOS", () => {
    Object.defineProperty(process, "platform", { value: Platform.MACOS });
    applyMainAppMenu();
    expect(Menu.buildFromTemplate).toHaveBeenCalledOnce();
    expect(Menu.setApplicationMenu).toHaveBeenCalledOnce();
    expect(vi.mocked(Menu.setApplicationMenu).mock.calls[0]?.[0]).not.toBeNull();
  });

  it("includes the Edit submenu on macOS so Cmd-C/V/X/A keep working", () => {
    Object.defineProperty(process, "platform", { value: Platform.MACOS });
    applyMainAppMenu();
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0]?.[0] ?? [];
    const editSubmenu = template.find((item) => item.label === "Edit");
    expect(editSubmenu).toBeDefined();
    const editRoles = (editSubmenu?.submenu as { role?: string }[] | undefined)
      ?.map((item) => item.role)
      .filter((role): role is string => role !== undefined);
    expect(editRoles).toEqual(
      expect.arrayContaining(["cut", "copy", "paste", "selectAll"]),
    );
  });

  it("strips the menu bar on Linux", () => {
    Object.defineProperty(process, "platform", { value: Platform.LINUX });
    applyMainAppMenu();
    expect(Menu.setApplicationMenu).toHaveBeenCalledExactlyOnceWith(null);
    expect(Menu.buildFromTemplate).not.toHaveBeenCalled();
  });

  it("strips the menu bar on Windows", () => {
    Object.defineProperty(process, "platform", { value: Platform.WINDOWS });
    applyMainAppMenu();
    expect(Menu.setApplicationMenu).toHaveBeenCalledExactlyOnceWith(null);
    expect(Menu.buildFromTemplate).not.toHaveBeenCalled();
  });
});
