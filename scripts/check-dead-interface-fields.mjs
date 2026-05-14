#!/usr/bin/env node
/**
 * Flag exported-interface (or type-alias-with-object-literal) properties
 * never read via PropertyAccessExpression anywhere in the package's TS
 * sources. v1 misses destructuring, computed reads, cross-package reads.
 *
 * Scaffold-only in this commit — loads each <pkg-dir> tsconfig and exits
 * clean. Detection logic lands in the follow-up commit.
 *
 * Usage: node scripts/check-dead-interface-fields.mjs <pkg-dir>...
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, exit } from "node:process";

import ts from "typescript";

const args = argv.slice(2);
if (args.length === 0) {
  console.error("usage: check-dead-interface-fields <pkg-dir>...");
  exit(2);
}

/**
 * Build a TS Program for one workspace package.
 * @param pkgDir - tsconfig.json dir.
 * @returns Configured Program.
 */
function loadProgram(pkgDir) {
  const cfg = resolve(pkgDir, "tsconfig.json");
  if (!existsSync(cfg)) {throw new Error(`no tsconfig: ${pkgDir}`);}
  const { config } = ts.readConfigFile(cfg, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, dirname(cfg));
  return ts.createProgram(parsed.fileNames, parsed.options);
}

for (const pkg of args) {
  loadProgram(resolve(pkg));
}
console.log("✓ no dead interface fields (scaffold — detection pending)");
