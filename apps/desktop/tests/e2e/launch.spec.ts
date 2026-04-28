// Tier 3 — E2E launch test. Boots the actual built Electron app and asserts
// the renderer mounts, PocketBase comes up, and auto-auth completes. Runs on
// the bundled `out/` output, so `pnpm build` must have run first.
//
// Requires a display server. CI invokes this via `xvfb-run`. Locally, run
// from inside the Distrobox shell where the host display is available.
import { _electron as electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..", "..");
const mainBundle = join(appRoot, "out", "main", "index.js");

test("Electron launches, renderer mounts, auto-auth completes", async () => {
  const electronApp = await electron.launch({
    args: [mainBundle],
    cwd: appRoot,
  });

  const window = await electronApp.firstWindow();
  await window.waitForSelector("text=Signed in as", { timeout: 30_000 });

  // Auto-auth populated the email line.
  const emailLine = await window.locator("text=/Signed in as .+@felafel\\.local/").textContent();
  expect(emailLine).toMatch(/Signed in as .+@felafel\.local/);

  // PocketBase URL renders into the page in the form `http://127.0.0.1:80xx`.
  const pbLine = await window.locator("text=/http:\\/\\/127\\.0\\.0\\.1:8\\d{3}/").textContent();
  expect(pbLine).toMatch(/http:\/\/127\.0\.0\.1:8\d{3}/);

  await electronApp.close();
});

test("quitting the app does not leave an orphan PocketBase process", async () => {
  const electronApp = await electron.launch({ args: [mainBundle], cwd: appRoot });
  const window = await electronApp.firstWindow();
  await window.waitForSelector("text=Signed in as", { timeout: 30_000 });
  await electronApp.close();

  // Give the SIGTERM/SIGKILL flow up to 6 seconds.
  await new Promise((r) => setTimeout(r, 6_000));

  // `ps -A -o command=` lists every running command. None should be our PB binary.
  const psOutput = execFileSync("ps", ["-A", "-o", "command="], { encoding: "utf8" });
  const orphans = psOutput
    .split("\n")
    .filter((line) => line.includes("/resources/pocketbase/") && line.includes("serve"));
  expect(orphans).toEqual([]);
});
