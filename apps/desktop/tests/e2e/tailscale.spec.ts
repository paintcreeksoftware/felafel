// Tier 3 — E2E for the Tailscale pill. Boots Electron with
// FELAFEL_TAILSCALE_FAKE pointed at a fixture script so the renderer's
// mount-time probe sees a deterministic state without needing a real
// tailscaled on the host.
//
// Two specs (connected + disconnected) instead of one with state-flipping
// because the FELAFEL_TAILSCALE_FAKE env var is fixed at launch.
import { _electron as electron, expect, test } from "@playwright/test";
import { join } from "node:path";

const here = import.meta.dirname;
const appRoot = join(here, "..", "..");
const mainBundle = join(appRoot, "out", "main", "index.js");
const fixturesDir = join(here, "fixtures");

test("Tailscale pill renders connected state when fake CLI reports Running", async () => {
  const electronApp = await electron.launch({
    args: [mainBundle],
    cwd: appRoot,
    env: {
      ...process.env,
      FELAFEL_TAILSCALE_FAKE: join(fixturesDir, "tailscale-connected"),
    },
  });

  const window = await electronApp.firstWindow();
  // Wait until the orchestrator status row is up so we know the renderer
  // fully mounted before asserting on the pill. "Orchestrator:" is the label
  // and shows regardless of starting/ready/error.
  await window.waitForSelector("text=Orchestrator:", { timeout: 30_000 });
  // Tailscale pill is non-blocking on app launch — give the post-mount probe
  // a moment to flip the badge from "Checking…" to the connected state.
  await expect(window.locator('[data-testid="ts-pill"]')).toContainText("Connected to", {
    timeout: 10_000,
  });
  await expect(window.locator('[data-testid="ts-pill"]')).toContainText("test-tailnet");

  await electronApp.close();
});

test("Tailscale pill renders disconnected state when fake CLI reports NeedsLogin", async () => {
  const electronApp = await electron.launch({
    args: [mainBundle],
    cwd: appRoot,
    env: {
      ...process.env,
      FELAFEL_TAILSCALE_FAKE: join(fixturesDir, "tailscale-disconnected"),
    },
  });

  const window = await electronApp.firstWindow();
  await window.waitForSelector("text=Orchestrator:", { timeout: 30_000 });
  await expect(window.locator('[data-testid="ts-pill"]')).toContainText("Connect to Tailscale", {
    timeout: 10_000,
  });

  await electronApp.close();
});
