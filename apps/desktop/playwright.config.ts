// Playwright config — drives the built Electron app for E2E and visual
// regression. Tests live under `tests/e2e/`. Snapshots live next to specs in
// `<spec>.spec.ts-snapshots/` (Playwright default) and are committed.
//
// Captures traces + screenshots only on failure to keep PR diffs small.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Electron app is a singleton; serialize tests
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  expect: {
    // Allow tiny pixel-diffs from font rendering between Fedora (Distrobox)
    // and ubuntu-latest (CI). Tighten this if visual regressions get noisy.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
});
