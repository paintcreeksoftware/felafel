#!/usr/bin/env node
/**
 * Flag exported-interface (or type-alias-with-object-literal) properties
 * never read via PropertyAccessExpression anywhere in the package's TS
 * sources. v1 misses destructuring, computed reads, cross-package reads.
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

// Detection logic temporarily stripped — full ts-morph rewrite lands in
// the follow-up commit. For now, load each program (to validate paths)
// and exit non-zero so CI keeps the dead-field check visibly red.
for (const pkg of args) {
  loadProgram(resolve(pkg));
}
console.error("dead-fields detection: rewrite pending (ts-morph swap)");
exit(1);
