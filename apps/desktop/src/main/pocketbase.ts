// PocketBase sidecar lifecycle. PocketBase is a Go binary (not an npm package),
// so we ship it inside the Electron app as a "sidecar" — a child process
// spawned by main and bound to localhost. The renderer talks to it over HTTP
// via the JS SDK.
//
// On startup we:
//   1. Load (or generate) a superuser email/password persisted to userData
//   2. Run `pocketbase superuser upsert` synchronously to ensure the account
//      exists in the DB matching those credentials
//   3. Spawn `pocketbase serve` long-lived
//   4. Wait for /api/health to respond before letting the window open
//
// The renderer never sees a login screen — it asks main for credentials over
// IPC and authenticates programmatically.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { app } from "electron";
import getPort, { portNumbers } from "get-port";
import type { SuperuserCredentials } from "@felafel/shared";

let pbProcess: ChildProcess | null = null;
let cachedCredentials: SuperuserCredentials | null = null;

// Maps Node's process.platform/arch onto the directory layout the download
// script writes into resources/pocketbase/. Pure: takes platform/arch as
// args so tests can call it directly without stubbing process globals.
export function platformDir(platform: NodeJS.Platform, arch: string): string {
  const p = platform === "win32" ? "win" : platform === "darwin" ? "darwin" : "linux";
  return `${p}-${arch}`;
}

export function binaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "pocketbase.exe" : "pocketbase";
}

// Strip non-email-safe characters from an OS username and fall back to "admin"
// if nothing valid remains. Pure helper — testable without filesystem access.
export function sanitizeUsername(raw: string): string {
  const sanitized = raw.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return sanitized || "admin";
}

// In dev: read from the repo's resources/ dir. In a packaged build:
// process.resourcesPath/pocketbase/ — that's where electron-builder's
// extraResources puts it.
function resolveBinaryPath(): string {
  const dir = platformDir(process.platform, process.arch);
  const name = binaryName(process.platform);
  if (app.isPackaged) {
    return join(process.resourcesPath, "pocketbase", name);
  }
  return join(app.getAppPath(), "resources", "pocketbase", dir, name);
}

// pb_data lives in the OS's userData dir for the packaged app (so it survives
// upgrades) and in a gitignored repo-local folder during dev.
function resolveDataDir(): string {
  if (app.isPackaged) {
    return join(app.getPath("userData"), "pb_data");
  }
  return join(app.getAppPath(), ".dev-pb_data");
}

// On first run: invoke the fallback to build new creds (production: derive
// from the OS username + cryptographic random password), persist with mode
// 0600 so other users on the same machine can't read it. On subsequent runs:
// load and reuse — `superuser upsert` makes that idempotent against the DB.
//
// Pure-ish: takes the credentials path and a fallback factory as arguments,
// so tests can point it at a tmp dir and pass a known credential generator.
export async function loadOrGenerateCredentials(
  credsPath: string,
  fallback: () => SuperuserCredentials,
): Promise<SuperuserCredentials> {
  if (existsSync(credsPath)) {
    try {
      const raw = await readFile(credsPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SuperuserCredentials>;
      if (typeof parsed.email === "string" && typeof parsed.password === "string") {
        return { email: parsed.email, password: parsed.password };
      }
    } catch {
      // corrupted — fall through and regenerate
    }
  }
  const creds = fallback();
  await mkdir(dirname(credsPath), { recursive: true });
  await writeFile(credsPath, JSON.stringify(creds, null, 2));
  await chmod(credsPath, 0o600);
  return creds;
}

// Production fallback factory — derives the email from the OS username and
// generates a fresh random password.
function defaultCredentialsFactory(): SuperuserCredentials {
  const username = userInfo().username || "admin";
  return {
    email: `${sanitizeUsername(username)}@felafel.local`,
    password: randomBytes(24).toString("base64url"),
  };
}

// Synchronous CLI invocation — `superuser upsert` exits when done. We run this
// BEFORE `serve` (long-lived) so the DB is guaranteed to have the account when
// the renderer tries to authenticate.
function upsertSuperuser(binary: string, dataDir: string, creds: SuperuserCredentials): void {
  const result = spawnSync(
    binary,
    ["superuser", "upsert", creds.email, creds.password, `--dir=${dataDir}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() ?? "";
    const stdout = result.stdout?.toString().trim() ?? "";
    throw new Error(`pocketbase superuser upsert failed: ${stderr || stdout || "unknown error"}`);
  }
}

// Don't open the BrowserWindow until PocketBase actually answers — otherwise
// the renderer's first request races the server's startup and fails.
async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`PocketBase did not become ready within ${timeoutMs}ms`);
}

export async function startPocketBase(): Promise<string> {
  const binary = resolveBinaryPath();
  if (!existsSync(binary)) {
    throw new Error(
      `PocketBase binary missing at ${binary}. Run \`node scripts/download-pocketbase.mjs\`.`,
    );
  }

  const dataDir = resolveDataDir();
  await mkdir(dataDir, { recursive: true });

  const credsPath = join(app.getPath("userData"), "admin.json");
  cachedCredentials = await loadOrGenerateCredentials(credsPath, defaultCredentialsFactory);
  upsertSuperuser(binary, dataDir, cachedCredentials);

  // Bind to a random port in the 8090 range to avoid clashing with another
  // running PocketBase instance on the same machine.
  const port = await getPort({ port: portNumbers(8090, 8190) });
  const host = `127.0.0.1:${port}`;
  const url = `http://${host}`;

  // BROWSER=echo neutralizes any xdg-open call PocketBase might make on first
  // run — without this, distrobox/container setups can pop a confused
  // host-Firefox dialog.
  pbProcess = spawn(binary, ["serve", `--http=${host}`, `--dir=${dataDir}`], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, BROWSER: "echo" },
  });

  pbProcess.on("exit", (code, signal) => {
    console.error(`[pocketbase] exited code=${code} signal=${signal}`);
    pbProcess = null;
  });

  await waitForServer(url);
  return url;
}

export function getCredentials(): SuperuserCredentials | null {
  return cachedCredentials;
}

// Graceful shutdown: SIGTERM first, give PocketBase 5s to flush, then SIGKILL.
// Without this, quitting Electron leaks an orphan PB process.
export async function stopPocketBase(): Promise<void> {
  const proc = pbProcess;
  if (!proc) return;
  pbProcess = null;
  proc.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 5_000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
