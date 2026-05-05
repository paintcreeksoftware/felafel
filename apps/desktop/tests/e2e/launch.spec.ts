// Tier 3 — E2E launch test. Boots the actual built Electron app and asserts
// the renderer mounts and the orchestrator reaches "ready". Runs on the
// bundled `out/` output, so `pnpm build` must have run first.
//
// Requires a display server. CI invokes this via `xvfb-run`. Locally, run
// from inside the Distrobox shell where the host display is available.
import { _electron as electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "pathe";

const here = import.meta.dirname;
const appRoot = join(here, "..", "..");
const mainBundle = join(appRoot, "out", "main", "index.js");
// Same path the orchestrator uses in dev mode — see
// apps/desktop/src/main/orchestrator.ts:resolveDataDir. Lives at
// apps/desktop/.dev-orchestrator-data, NOT the repo root: moduleDir
// (apps/desktop/out/main) joined with ../../.dev-orchestrator-data
// resolves under apps/desktop. Duplicated rather than imported because
// the path-alias lint rule covers `src/` only and tests/e2e/ siblings
// can't use the @felafel/desktop/... alias.
const devOrchestratorDataDir = join(appRoot, ".dev-orchestrator-data");

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

test("Workers panel reflects a worker that registered after mount", async () => {
  // PAI-108 regression: the renderer used to fetch GET /workers exactly
  // once on mount (when orchUrl became available). A worker that
  // registered later never appeared in the UI even though the
  // orchestrator's DB had it. Fix: poll every 5s. This test asserts the
  // poll picks up a fresh registration within ~12s (2x the cadence with
  // headroom for jitter on CI runners).
  const electronApp = await electron.launch({ args: [mainBundle], cwd: appRoot });
  const window = await electronApp.firstWindow();
  await window.waitForSelector("text=No workers registered yet", { timeout: 30_000 });

  // Pull the orchestrator URL out of the UI — the renderer renders it
  // verbatim next to "ready".
  const urlEl = window.locator(String.raw`text=/http:\/\/127\.0\.0\.1:\d{4,5}/`).first();
  const orchUrl = (await urlEl.textContent())?.match(/http:\/\/127\.0\.0\.1:\d{4,5}/)?.[0];
  expect(orchUrl).toBeTruthy();

  const registration = {
    // Valid v4 UUID — WorkerRegistrationSchema's `id: z.uuid()` enforces
    // version-tagged UUIDs (3rd group starts with 4, 4th with 8/9/a/b).
    id: "11111111-1111-4111-8111-111111111111",
    hostname: "polling-test-worker",
    controlPlaneUrl: "http://127.0.0.1:65535",
    os: "linux" as const,
    arch: "x64" as const,
  };
  const res = await fetch(`${orchUrl ?? ""}/workers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(registration),
  });
  // Surface the response body if registration fails — otherwise the bare
  // `expect(res.ok).toBe(true)` failure tells you nothing about why.
  expect(res.ok, `POST /workers ${res.status}: ${await res.text()}`).toBe(true);

  await window.waitForSelector(`text=${registration.hostname}`, { timeout: 12_000 });

  await electronApp.close();
  // Clean up the registration so later tests in the same run (visual.spec
  // expects "No workers registered yet") don't see the leftover row.
  // electronApp.close() is awaited above, so the orchestrator child has
  // exited and released its SQLite locks by the time we rm.
  await rm(devOrchestratorDataDir, { recursive: true, force: true });
});

test("Linux/Windows main window has no application menu", async () => {
  // Regression test for PAI-78: setApplicationMenu(null) was applied to
  // strip electron-vite's stock File/Edit/View menu. The visual snapshot
  // can't catch a menu coming back (renderer viewport is pinned, menu
  // chrome lives outside it), so we ask Electron directly.
  const electronApp = await electron.launch({ args: [mainBundle], cwd: appRoot });
  await electronApp.firstWindow();
  const menu = await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu());
  expect(menu).toBeNull();
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
