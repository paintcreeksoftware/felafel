#!/usr/bin/env node
// Detect drift between `packages/ui/src/components/ui/*.tsx` and the
// canonical shadcn registry. Two modes:
//
//   node scripts/check-shadcn-registry-drift.mjs            # report only
//   node scripts/check-shadcn-registry-drift.mjs --apply    # write upstream to local
//
// The workflow at .github/workflows/shadcn-drift.yml runs `--apply` weekly
// and opens a PR when files change. Manual runs default to `--check`.
//
// Why this exists: shadcn components are *copied into* the consumer's repo
// (per shadcn's "registry, not library" philosophy), so they don't track
// upstream automatically. This script closes that loop by polling the
// registry, normalizing the component's `@/...` imports to this project's
// `@felafel/ui/...` aliases (per components.json), and surfacing the diff
// for review.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
const COMPONENTS_DIR = join(REPO_ROOT, "packages/ui/src/components/ui");
const COMPONENTS_JSON = join(REPO_ROOT, "packages/ui/components.json");

/**
 * Load the project's shadcn config and derive the registry URL pattern
 * + alias substitutions needed to compare upstream to local.
 * @returns the config object the rest of the script reads from
 */
function loadShadcnConfig() {
  const cfg = JSON.parse(readFileSync(COMPONENTS_JSON, "utf8"));
  const style = cfg.style ?? "default";
  return {
    style,
    // shadcn upstream uses two import-path conventions across the registry:
    //   - `@/<subdir>/...`              (e.g. `@/components/ui/button`)
    //   - `@/registry/<style>/<subdir>/...` (e.g. `@/registry/new-york/ui/button`)
    // The shadcn CLI rewrites both on `add` per components.json#aliases. We
    // mirror that here so a local-vs-upstream diff shows real semantic
    // differences (not alias-substitution noise).
    //
    // Order matters within each prefix family: longer subpaths first, so
    // `@/components/ui/...` doesn't get partially-rewritten by the
    // `@/components/...` rule.
    aliasSubstitutions: [
      { from: "@/components/ui", to: cfg.aliases.ui },
      { from: "@/components", to: cfg.aliases.components },
      { from: "@/lib/utils", to: cfg.aliases.utils },
      { from: "@/lib", to: cfg.aliases.lib },
      { from: "@/hooks", to: cfg.aliases.hooks },
      { from: `@/registry/${style}/components`, to: cfg.aliases.components },
      { from: `@/registry/${style}/lib/utils`, to: cfg.aliases.utils },
      { from: `@/registry/${style}/lib`, to: cfg.aliases.lib },
      { from: `@/registry/${style}/hooks`, to: cfg.aliases.hooks },
      { from: `@/registry/${style}/ui`, to: cfg.aliases.ui },
    ],
  };
}

/**
 * Fetch the upstream registry JSON for `<name>` and return its raw file
 * contents (one entry per file the component ships).
 * @param style - shadcn style (e.g. `"new-york"`)
 * @param name - component name (matches the local filename without `.tsx`)
 * @returns an array of `{ path, content }` from the registry, or null if 404
 */
async function fetchUpstreamComponent(style, name) {
  const url = `https://ui.shadcn.com/r/styles/${style}/${name}.json`;
  const res = await fetch(url);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`fetch ${url} → HTTP ${res.status}`);
  }
  const body = await res.json();
  return body.files ?? [];
}

const TS_NOCHECK_HEADER = "// @ts-nocheck\n";

/**
 * Prepend the ts-nocheck pragma to vendored content if not already
 * present. Used for both registry-fetched files (via normalizeUpstream)
 * and for project-built primitives in the same folder that the registry
 * doesn't cover (e.g. `combobox.tsx`, which 404s upstream). The whole
 * `packages/ui/src/components/ui/` folder is treated as vendored and
 * not gated on this project's strict tsc settings — strict tsc on
 * upstream surfaces noise like Recharts tooltip-prop strictness and
 * implicit-any params that are runtime-correct.
 * TODO(PAI-148): once Storybook lands as the runtime-smoke surface for
 * these primitives, revisit whether we can drop the pragma and let
 * strict tsc back in — Storybook would catch real breakage even if tsc
 * doesn't.
 * @param content - file content to ensure has the header
 * @returns content with header guaranteed at the top
 */
function withHeader(content) {
  return content.startsWith(TS_NOCHECK_HEADER) ? content : `${TS_NOCHECK_HEADER}${content}`;
}

/**
 * Rewrite upstream `@/...` imports to the project's `@felafel/ui/...`
 * aliases so a local-vs-upstream diff shows real semantic differences
 * (not the alias-substitution noise the shadcn CLI does at `add` time).
 * @param upstream - raw upstream content
 * @param substitutions - mapping table from loadShadcnConfig
 * @returns upstream content with aliases rewritten + ts-nocheck header
 */
function normalizeUpstream(upstream, substitutions) {
  let out = upstream;
  for (const { from, to } of substitutions) {
    out = out.replaceAll(from, to);
  }
  return withHeader(out);
}

/**
 * Compare normalized upstream to local content.
 * @param local - local file contents
 * @param upstream - normalized upstream contents
 * @returns true when the files differ in content
 */
function differs(local, upstream) {
  return local.trimEnd() !== upstream.trimEnd();
}

/**
 * List the .tsx component files under `packages/ui/src/components/ui/`.
 * @returns array of `{ name, path }` for each component
 */
function listLocalComponents() {
  return readdirSync(COMPONENTS_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ name: f.replace(/\.tsx$/u, ""), path: join(COMPONENTS_DIR, f) }));
}

/**
 * Idempotently ensure the ts-nocheck header on every file in the
 * folder, not just the registry-tracked ones. Files where the registry
 * 404s (project-built primitives like `combobox.tsx`) are still
 * vendored content as far as this project's gates are concerned, so
 * they need the same header invariant.
 * @param local - array of `{ name, path }` from listLocalComponents
 */
function ensureFolderHeaders(local) {
  let headerAdded = 0;
  for (const { path } of local) {
    const current = readFileSync(path, "utf8");
    const fixed = withHeader(current);
    if (fixed !== current) {
      writeFileSync(path, fixed);
      headerAdded += 1;
    }
  }
  if (headerAdded > 0) {
    console.log(`Added ts-nocheck header to ${headerAdded} additional file(s).`);
  }
}

/**
 * Walk every component under `packages/ui/src/components/ui/`, fetch
 * its upstream registry version, normalize the imports, and either
 * report drift (default) or write the upstream content to disk
 * (`--apply`). Exits non-zero when any drift is detected so callers
 * (the weekly workflow, local dev scripts) can branch on the result.
 * @returns the script's exit promise — never resolves; calls process.exit
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const { style, aliasSubstitutions } = loadShadcnConfig();
  const local = listLocalComponents();
  const drifted = [];
  const skipped = [];
  for (const { name, path } of local) {
    const upstream = await fetchUpstreamComponent(style, name);
    if (upstream === null) {
      // Either a project-built component (not in the registry) or a typo.
      // Either way, drift detection doesn't apply.
      skipped.push(name);
      continue;
    }
    // shadcn components are single-file (the .tsx). Components shipped as
    // multi-file (e.g. carousel + helper) would need richer handling; skip
    // those for now and warn so the human knows to handle them manually.
    if (upstream.length !== 1) {
      console.warn(`[skip] ${name}: registry returned ${upstream.length} files (multi-file component); needs manual handling`);
      continue;
    }
    const normalized = normalizeUpstream(upstream[0].content, aliasSubstitutions);
    const localContent = readFileSync(path, "utf8");
    if (differs(localContent, normalized)) {
      drifted.push({ name, path, normalized });
    }
  }
  console.log(`Checked ${local.length} components (${skipped.length} skipped — not in registry).`);
  console.log(`Drift detected in ${drifted.length} component(s).`);
  for (const { name } of drifted) {
    console.log(`  - ${name}`);
  }
  if (apply && drifted.length > 0) {
    for (const { path, normalized } of drifted) {
      // Preserve the trailing newline convention the rest of the repo
      // uses (LF-terminated files).
      writeFileSync(path, normalized.endsWith("\n") ? normalized : `${normalized}\n`);
    }
    console.log(`Applied upstream content to ${drifted.length} file(s).`);
  }
  if (apply) {
    ensureFolderHeaders(local);
  }
  // Exit non-zero on drift so the workflow's "create PR if there's drift"
  // step can branch on it. In check-only mode this is informational; in
  // apply mode the workflow uses git-status anyway, but the consistent
  // exit code lets local dev script the same way.
  process.exit(drifted.length > 0 ? 1 : 0);
}

await main();
