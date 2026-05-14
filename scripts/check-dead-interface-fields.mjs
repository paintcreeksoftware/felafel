#!/usr/bin/env node
/**
 * Flag exported-interface (or type-alias-with-object-literal) properties
 * never read anywhere in the package's TS sources. Uses ts-morph's
 * findReferencesAsNodes which transparently covers PropertyAccess,
 * destructuring, and computed reads.
 *
 * Usage: node scripts/check-dead-interface-fields.mjs <pkg-dir>...
 */

import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { argv, cwd, exit } from "node:process";

import { Project, SyntaxKind } from "ts-morph";

const args = argv.slice(2);
if (args.length === 0) {
  console.error("usage: check-dead-interface-fields <pkg-dir>...");
  exit(2);
}

/**
 * Yield exported [container decl, property signature] pairs from a
 * ts-morph SourceFile. Covers interfaces + type-alias-with-type-literal.
 * @param sf - ts-morph SourceFile.
 * @yields [container declaration, PropertySignature] pairs.
 */
function* exportedProps(sf) {
  for (const iface of sf.getInterfaces()) {
    if (!iface.isExported()) {continue;}
    for (const p of iface.getProperties()) {yield [iface, p];}
  }
  for (const alias of sf.getTypeAliases()) {
    if (!alias.isExported()) {continue;}
    const tn = alias.getTypeNode();
    if (tn?.getKind() !== SyntaxKind.TypeLiteral) {continue;}
    const members = tn.asKindOrThrow(SyntaxKind.TypeLiteral).getProperties();
    for (const p of members) {yield [alias, p];}
  }
}

const offenders = [];
const root = cwd();
for (const pkg of args) {
  const tsconfig = resolve(pkg, "tsconfig.json");
  if (!existsSync(tsconfig)) {throw new Error(`no tsconfig: ${pkg}`);}
  const project = new Project({ tsConfigFilePath: tsconfig });
  for (const sf of project.getSourceFiles()) {
    if (!sf.getFilePath().includes("/src/")) {continue;}
    for (const [decl, prop] of exportedProps(sf)) {
      // findReferencesAsNodes returns use sites only (declaration not
      // included); length > 0 means at least one consumer reads it.
      if (prop.getNameNode().findReferencesAsNodes().length > 0) {continue;}
      offenders.push({
        file: relative(root, sf.getFilePath()),
        line: prop.getStartLineNumber(),
        type: decl.getName(),
        prop: prop.getName(),
      });
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
