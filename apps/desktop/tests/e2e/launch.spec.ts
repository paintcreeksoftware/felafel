// Tier 3 — E2E launch test. Boots the actual built Electron app and asserts
// the renderer mounts and the orchestrator reaches "ready". Runs on the
// bundled `out/` output, so `pnpm build` must have run first.
//
// Requires a display server. CI invokes this via `xvfb-run`. Locally, run
// from inside the Distrobox shell where the host display is available.
import { _electron as electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join } from "pathe";

const here = import.meta.dirname;
const appRoot = join(here, "..", "..");
const mainBundle = join(appRoot, "out", "main", "index.js");

test("Electron launches, orchestrator reaches ready", async () => {
  const electronApp = await electron.launch({
    args: [mainBundle],
    cwd: appRoot,
  });

  const window = await electronApp.firstWindow();
  await window.waitForSelector("text=Orchestrator:", { timeout: 30_000 });
  await window.waitForSelector("text=ready", { timeout: 30_000 });

  // Orchestrator URL renders as `http://127.0.0.1:<port>`. The port is
  // kernel-assigned (bind to 0), so it's whatever ephemeral port the OS
  // hands us — Linux typically 32768–60999, macOS/Windows 49152–65535.
  const urlLine = await window.locator(String.raw`text=/http:\/\/127\.0\.0\.1:\d{4,5}/`).textContent();
  expect(urlLine).toMatch(/http:\/\/127\.0\.0\.1:\d{4,5}/);

  // Empty worker list rendered.
  await window.waitForSelector("text=No workers registered yet", { timeout: 5_000 });

  await electronApp.close();
});

test("quitting the app does not leave an orphan orchestrator process", async () => {
  const electronApp = await electron.launch({ args: [mainBundle], cwd: appRoot });
  const window = await electronApp.firstWindow();
  await window.waitForSelector("text=Orchestrator:", { timeout: 30_000 });
  await electronApp.close();

  // Give the SIGTERM/SIGKILL flow up to 6 seconds.
  await new Promise((resolve) => {
    setTimeout(resolve, 6_000);
  });

  // `ps -A -o command=` lists every running command. None should be our
  // orchestrator bundle (`index.mjs` under resources/orchestrator/ in
  // packaged builds, or apps/orchestrator/dist/ in dev).
  const psOutput = execFileSync("ps", ["-A", "-o", "command="], { encoding: "utf8" });
  const orphans = psOutput
    .split("\n")
    .filter((line) => /orchestrator[/\\]dist[/\\]index\.mjs|resources[/\\]orchestrator[/\\]index\.mjs/.test(line));
  expect(orphans).toEqual([]);
});
