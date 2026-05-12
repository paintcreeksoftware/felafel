#!/usr/bin/env node
// Validate every `@felafel/<pkg>/<sub-path>` import in source against the
// target package's package.json#exports. TypeScript follows tsconfig.json
// `paths` at typecheck time and Vite/Rollup follow package.json `exports`
// at bundle time — they're independent resolvers and free to drift.
// PAI-139 PR #57 broke because @felafel/tailscale/ui/Pill typechecked
// clean via `paths` but Vite couldn't find it in `exports`. This script
// closes that gap; runs as `pnpm lint:exports` in pre-commit + CI.

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Discover every `@felafel/*` workspace by scanning apps/* + packages/*. */
function discoverWorkspaces() {
  const map = new Map();
  for (const parent of ["apps", "packages"]) {
    const parentDir = join(REPO_ROOT, parent);
    for (const entry of readdirSync(parentDir)) {
      const pkgJsonPath = join(parentDir, entry, "package.json");
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
        if (typeof pkg.name === "string" && pkg.name.startsWith("@felafel/")) {
          map.set(pkg.name, { exports: pkg.exports });
        }
      } catch {
        /* directory without a package.json — skip */
      }
    }
  }
  return map;
}

/**
 * True when `subPath` (the portion after `@felafel/<pkg>/`) is reachable
 * through any entry in `exportsMap`. Supports the Node spec's `*` wildcard
 * — `./foo/*` matches any path starting with `foo/`.
 */
function matchesAnyExport(subPath, exportsMap) {
  for (const key of Object.keys(exportsMap)) {
    if (matchesExportKey(subPath, key)) return true;
  }
  return false;
}

function matchesExportKey(subPath, exportKey) {
  if (subPath === "") return exportKey === ".";
  const key = exportKey.startsWith("./") ? exportKey.slice(2) : exportKey;
  if (!key || key === ".") return false;
  if (key.includes("*")) {
    const escaped = key.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("^" + escaped.replace(/\*/g, ".*") + "$").test(subPath);
  }
  return subPath === key;
}

/** Extract every bare-specifier `@felafel/...` import from one source string. */
function extractFelafelImports(source) {
  const found = [];
  const re = /(?:from|import)\s*\(?\s*["'](@felafel\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) found.push(m[1]);
  return found;
}

/** Tracked source files under apps/* + packages/* (skip .d.ts ambient files). */
function listSourceFiles() {
  const out = execSync("git ls-files apps packages", { cwd: REPO_ROOT, encoding: "utf8" });
  return out
    .split("\n")
    .filter((p) => /\.(ts|tsx|js|mjs|cjs)$/.test(p))
    .filter((p) => !p.endsWith(".d.ts"));
}

function main() {
  const workspaces = discoverWorkspaces();
  const offenders = [];
  for (const file of listSourceFiles()) {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    for (const spec of extractFelafelImports(source)) {
      const rest = spec.slice("@felafel/".length);
      const slash = rest.indexOf("/");
      const pkgName = slash === -1 ? `@felafel/${rest}` : `@felafel/${rest.slice(0, slash)}`;
      const subPath = slash === -1 ? "" : rest.slice(slash + 1);
      const ws = workspaces.get(pkgName);
      if (!ws) {
        offenders.push({ file, spec, reason: `unknown workspace ${pkgName}` });
        continue;
      }
      // A package without an `exports` field defers to the filesystem layout
      // (legacy resolution). Nothing to check.
      if (!ws.exports || Object.keys(ws.exports).length === 0) continue;
      if (!matchesAnyExport(subPath, ws.exports)) {
        offenders.push({
          file,
          spec,
          reason: `${pkgName} has no exports entry matching ./${subPath}`,
        });
      }
    }
  }
  if (offenders.length === 0) process.exit(0);
  console.error(`Found ${offenders.length} unresolved @felafel/* import(s):\n`);
  for (const o of offenders) {
    console.error(`  ${o.file}`);
    console.error(`    ${o.spec}`);
    console.error(`    ${o.reason}\n`);
  }
  process.exit(1);
}

main();
