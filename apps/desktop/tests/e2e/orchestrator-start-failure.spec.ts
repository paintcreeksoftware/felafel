// Tier 3 — E2E for the orchestrator start-failure rendering path. Boots
// the built Electron app with FELAFEL_ORCHESTRATOR_FAKE_BUNDLE pointed
// at a non-existent file so OrchestratorManager.start() throws "bundle
// missing", then asserts the renderer flips to the error state with the
// thrown message rendered in red instead of staying on "starting...".
//
// Mirrors the FELAFEL_TAILSCALE_FAKE pattern in tailscale.spec.ts —
// inject a fixture at the boundary instead of mocking spawn.
import { _electron as electron, expect, test } from "@playwright/test";
import { join } from "pathe";

const here = import.meta.dirname;
const appRoot = join(here, "..", "..");
const mainBundle = join(appRoot, "out", "main", "index.js");

test("renderer shows the start-failure message when the orchestrator bundle is missing", async () => {
  const electronApp = await electron.launch({
    args: [mainBundle],
    cwd: appRoot,
    env: {
      ...process.env,
      // Path is deliberately bogus — existsSync() returns false →
      // OrchestratorManager.start() throws "orchestrator bundle missing at <path>".
      FELAFEL_ORCHESTRATOR_FAKE_BUNDLE: "/nonexistent/orchestrator/bundle.mjs",
    },
  });

  const window = await electronApp.firstWindow();
  await window.waitForSelector("text=Orchestrator:", { timeout: 30_000 });
  // The catch block in DesktopApp.bootstrapOnReady broadcasts
  // OrchestratorStatus { kind: "error", message: <thrown> }; App.tsx
  // sets statusError, OrchestratorLabel renders it in text-destructive.
  // Match the substring rather than the full path so the assertion is
  // robust to path normalization across OSes.
  await expect(
    window.locator(String.raw`text=/orchestrator bundle missing at/`),
  ).toBeVisible({ timeout: 15_000 });

  await electronApp.close();
});
