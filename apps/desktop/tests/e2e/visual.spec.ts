// Tier 3 — basic visual regression. Captures a screenshot of the home
// screen after auto-auth completes, masks the dynamic regions (PocketBase
// URL contains a random port; the signed-in email contains the OS
// username), and pixel-diffs against a committed baseline on every CI run.
//
// First run with `pnpm test:e2e -- --update-snapshots` produces the
// baseline. Subsequent runs fail if the screenshot drifts more than
// `maxDiffPixelRatio` (configured in playwright.config.ts).
//
// Snapshots live in `visual.spec.ts-snapshots/` next to this file and are
// committed to the repo. Re-baseline by running --update-snapshots after
// intentional UI changes.
import { _electron as electron, expect, test } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..", "..");
const mainBundle = join(appRoot, "out", "main", "index.js");

test("home screen visual snapshot", async () => {
  const electronApp = await electron.launch({ args: [mainBundle], cwd: appRoot });
  const window = await electronApp.firstWindow();
  await window.waitForSelector("text=Orchestrator:", { timeout: 30_000 });
  await window.waitForSelector("text=No workers registered yet", { timeout: 30_000 });

  await expect(window).toHaveScreenshot("home.png", {
    mask: [
      // Random orchestrator port changes every run.
      window.locator("text=/http:\\/\\/127\\.0\\.0\\.1:9\\d{3}/"),
      // Tailscale pill state varies per environment (CI has no tailscale
      // binary, dev boxes might be connected to different tailnets).
      window.locator('[data-testid="ts-pill"]'),
    ],
  });

  await electronApp.close();
});
