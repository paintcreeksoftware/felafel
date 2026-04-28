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
  await window.waitForSelector("text=Signed in as", { timeout: 30_000 });

  await expect(window).toHaveScreenshot("home.png", {
    mask: [
      // Random port in the URL changes every run.
      window.locator("text=/http:\\/\\/127\\.0\\.0\\.1:8\\d{3}/"),
      // OS-derived email — different per machine / CI runner.
      window.locator("text=/Signed in as/").locator(".."),
    ],
  });

  await electronApp.close();
});
