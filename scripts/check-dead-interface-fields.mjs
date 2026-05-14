#!/usr/bin/env node
/**
 * Flag exported-interface (or type-alias-with-object-literal) properties
 * never read via PropertyAccessExpression anywhere in the package's TS
 * sources. v1 misses destructuring, computed reads, cross-package reads.
 *
 * Usage: node scripts/check-dead-interface-fields.mjs <pkg-dir>...
 */

import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { argv, cwd, exit } from "node:process";

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

/**
 * Pre-order descendants of `root`. `forEachChild` short-circuits on
 * truthy callback returns; the wrapper voids it so all children visit.
 * @param root - Subtree root.
 * @yields every descendant.
 */
function* walkSubtree(root) {
  yield root;
  const kids = [];
  ts.forEachChild(root, (c) => { kids.push(c); });
  for (const k of kids) {yield* walkSubtree(k);}
}

/**
 * Read-only `.propName` access count for `propSymbol` across program.
 * @param program - Loaded Program.
 * @param propSymbol - Property declaration symbol.
 * @returns Count of read sites.
 */
function countReads(program, propSymbol) {
  const checker = program.getTypeChecker();
  let n = 0;
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) {continue;}
    for (const node of walkSubtree(sf)) {
      if (!ts.isPropertyAccessExpression(node)) {continue;}
      if (checker.getSymbolAtLocation(node.name) !== propSymbol) {continue;}
      const { parent } = node;
      const isWrite = ts.isBinaryExpression(parent)
        && parent.left === node
        && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      if (!isWrite) {n++;}
    }
  }
  return n;
}

/**
 * Dead-field offenders for one exported interface / type-alias decl.
 * @param decl - InterfaceDeclaration or TypeAliasDeclaration (object).
 * @param sf - SourceFile containing `decl`.
 * @param program - Loaded Program.
 * @param checker - Type checker.
 * @param root - Repo root for path display.
 * @returns Offender records (possibly empty).
 */
function offendersInDecl(decl, sf, program, checker, root) {
  if (!(ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Export)) {return [];}
  const members = ts.isInterfaceDeclaration(decl)
    ? decl.members
    : decl.type.members;
  const list = [];
  for (const m of members) {
    if (!ts.isPropertySignature(m) || !ts.isIdentifier(m.name)) {continue;}
    const sym = checker.getSymbolAtLocation(m.name);
    if (!sym || countReads(program, sym) > 0) {continue;}
    const { line } = sf.getLineAndCharacterOfPosition(m.getStart());
    list.push({
      file: relative(root, sf.fileName),
      line: line + 1,
      type: decl.name.text,
      prop: m.name.text,
    });
  }
  return list;
}

const offenders = [];
const root = cwd();
for (const pkg of args) {
  const program = loadProgram(resolve(pkg));
  const checker = program.getTypeChecker();
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !sf.fileName.includes("/src/")) {continue;}
    for (const node of walkSubtree(sf)) {
      const isType = ts.isInterfaceDeclaration(node)
        || (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type));
      if (!isType) {continue;}
      offenders.push(...offendersInDecl(node, sf, program, checker, root));
    }
  }
}

if (offenders.length > 0) {
  console.error("Dead interface fields (declared but never read):");
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  ${o.type}.${o.prop}`);
  }
  exit(1);
}
console.log("✓ no dead interface fields");
