#!/usr/bin/env bash
#
# audit-console-leakage.sh — flag `console.*` calls in source that
# the project's `no-console` lint rule SHOULD have caught. Tests +
# scripts + dist + out are carved out via pathspec exclusions to
# match the lint config.
#
# Usage: `pnpm audit:console`. Exits non-zero with the offender
# list when something slips past lint, exit 0 otherwise. Consumed
# by the `observability-reviewer` subagent.

set -euo pipefail

# Patterns: console.log / .info / .warn / .error / .debug.
# Carve-outs match the no-console lint override list in
# `eslint.config.mjs` (PAI-175): tests, scripts, eslint internals.
exclude_globs=(
  ':!*.test.ts'
  ':!*.test.tsx'
  ':!**/__tests__/**'
  ':!**/e2e/**'
  ':!scripts/**'
  ':!eslint/**'
  ':!**/coverage/**'
  ':!**/out/**'
  ':!**/dist/**'
  ':!**/node_modules/**'
)

if ! offenders=$(git grep -nE '\bconsole\.(log|warn|error|info|debug)\b' -- '*.ts' '*.tsx' '*.mjs' "${exclude_globs[@]}"); then
  echo "✓ no console.* leakage outside carved-out paths"
  exit 0
fi

echo "FAIL: console.* found in source paths the no-console rule should cover"
echo
echo "$offenders"
exit 1
