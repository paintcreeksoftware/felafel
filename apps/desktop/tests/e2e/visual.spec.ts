// Tier 3 — basic visual regression. Captures a screenshot of the home
// screen after the orchestrator reaches "ready", masks the dynamic regions
// (random orchestrator port, Tailscale pill state), and pixel-diffs against
// a committed baseline on every CI run.
//
// First run with `pnpm test:e2e -- --update-snapshots` produces the
// baseline. Subsequent runs fail if the screenshot drifts more than
// `maxDiffPixelRatio` (configured in playwright.config.ts).
//
// Snapshots live in `visual.spec.ts-snapshots/` next to this file and are
// committed to the repo. Re-baseline by running --update-snapshots after
// intentional UI changes.
import { _electron as electron, expect, test } from "@playwright/test";
import { join } from "pathe";

const here = import.meta.dirname;
const appRoot = join(here, "..", "..");
const mainBundle = join(appRoot, "out", "main", "index.js");

test("home screen visual snapshot", async () => {
  const electronApp = await electron.launch({ args: [mainBundle], cwd: appRoot });
  const window = await electronApp.firstWindow();

  // Pin the viewport so the captured image is dimensionally identical
  // across environments. Without this, the BrowserWindow's content area
  // depends on the host window manager's chrome — Distrobox-on-GNOME
  // produces ~735px, xvfb-on-CI produces 773 — and the snapshot drifts.
  await window.setViewportSize({ width: 1200, height: 800 });

  await window.waitForSelector("text=Orchestrator:", { timeout: 30_000 });
  await window.waitForSelector("text=No workers registered yet", { timeout: 30_000 });

  await expect(window).toHaveScreenshot("home.png", {
    mask: [
      // Random orchestrator port changes every run (kernel-assigned ephemeral).
      window.locator(String.raw`text=/http:\/\/127\.0\.0\.1:\d{4,5}/`),
      // Tailscale pill state varies per environment (CI has no tailscale
      // binary, dev boxes might be connected to different tailnets).
      window.locator('[data-testid="ts-pill"]'),
    ],
  });

  await electronApp.close();
});
