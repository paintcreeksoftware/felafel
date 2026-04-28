#!/usr/bin/env node
//
// PocketBase binary fetcher. Runs as a `postinstall` step (so `pnpm install`
// triggers it) and as `prepackage` (with --all-platforms, so the installer can
// ship every platform's binary).
//
// PocketBase ships as a Go binary, not an npm package — we can't `npm install`
// it. This script downloads the platform-specific zip from GitHub releases,
// verifies SHA-256 against the release's checksums.txt, and unzips into
// resources/pocketbase/<platform>-<arch>/. The .version-X.X.X marker file makes
// re-runs idempotent.
//
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";

const POCKETBASE_VERSION = "0.37.4";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = join(__dirname, "..", "resources", "pocketbase");

const TARGETS = [
  { dir: "darwin-arm64", releasePlatform: "darwin", releaseArch: "arm64", exe: "pocketbase" },
  { dir: "darwin-x64", releasePlatform: "darwin", releaseArch: "amd64", exe: "pocketbase" },
  { dir: "linux-x64", releasePlatform: "linux", releaseArch: "amd64", exe: "pocketbase" },
  { dir: "linux-arm64", releasePlatform: "linux", releaseArch: "arm64", exe: "pocketbase" },
  { dir: "win-x64", releasePlatform: "windows", releaseArch: "amd64", exe: "pocketbase.exe" },
];

function hostTarget() {
  const archMap = { x64: "amd64", arm64: "arm64" };
  const platformMap = { linux: "linux", darwin: "darwin", win32: "windows" };
  const releasePlatform = platformMap[process.platform];
  const releaseArch = archMap[process.arch];
  if (!releasePlatform || !releaseArch) {
    throw new Error(`Unsupported host: ${process.platform}-${process.arch}`);
  }
  return TARGETS.find(
    (t) => t.releasePlatform === releasePlatform && t.releaseArch === releaseArch,
  );
}

async function fetchChecksums() {
  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/checksums.txt`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch checksums: ${res.status} ${url}`);
  const text = await res.text();
  const map = new Map();
  for (const line of text.split("\n")) {
    const [hash, file] = line.trim().split(/\s+/);
    if (hash && file) map.set(file, hash);
  }
  return map;
}

async function sha256OfFile(path) {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

async function downloadOne(target, checksums) {
  const filename = `pocketbase_${POCKETBASE_VERSION}_${target.releasePlatform}_${target.releaseArch}.zip`;
  const expectedHash = checksums.get(filename);
  if (!expectedHash) throw new Error(`No checksum entry for ${filename}`);

  const targetDir = join(RESOURCES_DIR, target.dir);
  const binaryPath = join(targetDir, target.exe);
  const versionMarker = join(targetDir, `.version-${POCKETBASE_VERSION}`);

  if (existsSync(binaryPath) && existsSync(versionMarker)) {
    return { target: target.dir, status: "cached" };
  }

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  const zipPath = join(targetDir, filename);
  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/${filename}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));

  const actualHash = await sha256OfFile(zipPath);
  if (actualHash !== expectedHash) {
    throw new Error(`Checksum mismatch for ${filename}: expected ${expectedHash}, got ${actualHash}`);
  }

  const unzip = spawnSync("unzip", ["-o", zipPath, "-d", targetDir], { stdio: "inherit" });
  if (unzip.status !== 0) throw new Error(`unzip failed for ${filename}`);

  await rm(zipPath);
  await chmod(binaryPath, 0o755).catch(() => {});

  await readFile(binaryPath);
  await import("node:fs/promises").then(({ writeFile }) => writeFile(versionMarker, ""));

  return { target: target.dir, status: "downloaded" };
}

async function main() {
  const allPlatforms = process.argv.includes("--all-platforms");
  const targets = allPlatforms ? TARGETS : [hostTarget()].filter(Boolean);

  if (targets.length === 0) {
    console.error("[pocketbase] No targets resolved.");
    process.exit(1);
  }

  console.log(
    `[pocketbase] Ensuring v${POCKETBASE_VERSION} for: ${targets.map((t) => t.dir).join(", ")}`,
  );
  const checksums = await fetchChecksums();
  for (const target of targets) {
    try {
      const result = await downloadOne(target, checksums);
      console.log(`[pocketbase] ${result.target}: ${result.status}`);
    } catch (err) {
      console.error(`[pocketbase] ${target.dir}: FAILED — ${err.message}`);
      if (!allPlatforms) process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
