#!/usr/bin/env bash
#
# pr-ready.sh — flip a draft PR to ready, after posting three PR
# comments (cost summary, memory-drift snapshot, test coverage).
# Atomic: every step succeeds before the ready flip, or the PR
# stays draft. Idempotent: re-running edits the existing marker
# comments in place rather than appending duplicates.
#
# Usage:  pnpm pr:ready <PR_NUMBER>
#         scripts/pr-ready.sh <PR_NUMBER>
#
# Comments (each identified by a hidden HTML marker on its first
# line so subsequent runs find + update in place):
#
#   <!-- claude-cost-comment -->     # cost from `pnpm cost:since HEAD`
#   <!-- claude-drift-comment -->    # memory-promoter findings table
#   <!-- claude-coverage-comment --> # per-package coverage table
#
# The PR body is left alone. The data sources are local-only —
# session JSONL for cost, `~/.claude/.../memory/` for drift, and
# `coverage/coverage-summary.json` from each workspace package for
# coverage — so a CI-only path can't reproduce them.

set -euo pipefail

pr="${1:?usage: pr-ready.sh <pr-number>}"

for bin in git gh claude; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: $bin not on PATH" >&2
    exit 1
  fi
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

# Post-or-update a PR comment identified by a hidden marker on its
# first line. Idempotent — finds an existing marker comment and
# PATCHes it; otherwise creates a fresh one.
upsert_comment() {
  local marker="$1"
  local body="$2"
  local existing_id
  existing_id=$(gh api "/repos/$repo/issues/$pr/comments" \
    --jq ".[] | select(.body | startswith(\"$marker\")) | .id" | head -n1)
  if [ -n "$existing_id" ]; then
    gh api -X PATCH "/repos/$repo/issues/comments/$existing_id" \
      -f body="$body" > /dev/null
  else
    gh pr comment "$pr" --repo "$repo" --body "$body" > /dev/null
  fi
}

echo "[pr-ready] computing cost summary..."
cost=$(pnpm cost:since HEAD)
if [ -z "$cost" ]; then
  echo "ERROR: pnpm cost:since returned empty output; aborting" >&2
  exit 1
fi
cost_marker='<!-- claude-cost-comment -->'
# shellcheck disable=SC2016 # backticks in the format string are markdown fences, not command substitution
cost_body=$(printf '%s\n## Cost summary\n\n```\n%s\n```' "$cost_marker" "$cost")
upsert_comment "$cost_marker" "$cost_body"
echo "[pr-ready] posted cost comment"

echo "[pr-ready] computing memory-drift snapshot..."
drift=$(claude -p --agent memory-promoter <<'PROMPT'
Output a single compact findings table — one row per memory rule with
columns: rule | state (encoded / needs-update / new / suggests-subagent)
| target agent file. No prose, no PR-opening, no edits. Plain text only,
suitable for embedding in a PR comment.
PROMPT
)
if [ -z "$drift" ]; then
  echo "ERROR: memory-promoter returned empty snapshot; aborting" >&2
  exit 1
fi
drift_marker='<!-- claude-drift-comment -->'
# shellcheck disable=SC2016 # backticks in the format string are markdown fences, not command substitution
drift_body=$(printf '%s\n## Memory drift snapshot\n\n%s\n' "$drift_marker" "$drift")
upsert_comment "$drift_marker" "$drift_body"
echo "[pr-ready] posted drift comment"

echo "[pr-ready] computing test coverage..."
# Tests already ran in pre-commit; this re-run is the price of getting
# json-summary output that the workspace's vitest configs don't emit by
# default. Per-package coverage-summary.json files land at
# `<workspace>/coverage/coverage-summary.json`; the loop below aggregates.
if ! pnpm test -- --coverage --coverage.reporter=json-summary --coverage.reporter=text-summary > /tmp/pr-ready-coverage.log 2>&1; then
  cat /tmp/pr-ready-coverage.log >&2
  echo "ERROR: pnpm test --coverage failed; aborting" >&2
  exit 1
fi

coverage_rows=""
while IFS= read -r summary; do
  pkg_dir=$(dirname "$(dirname "$summary")")
  pkg_name=$(jq -r '.name // "(unnamed)"' "$pkg_dir/package.json")
  lines=$(jq -r '.total.lines.pct' "$summary")
  branches=$(jq -r '.total.branches.pct' "$summary")
  functions=$(jq -r '.total.functions.pct' "$summary")
  statements=$(jq -r '.total.statements.pct' "$summary")
  coverage_rows+=$(printf '| %s | %s%% | %s%% | %s%% | %s%% |\n' \
    "$pkg_name" "$lines" "$branches" "$functions" "$statements")
  coverage_rows+=$'\n'
done < <(find apps packages -name coverage-summary.json -not -path '*/node_modules/*' 2>/dev/null | sort)

if [ -z "$coverage_rows" ]; then
  # shellcheck disable=SC2016 # backticks are markdown code spans, not subshells
  coverage_body=$(printf '%s\n## Test coverage\n\n_No `coverage-summary.json` produced. Add `coverage.reporter: ["json-summary"]` to the `vitest.config.ts` of packages you want surfaced here._' \
    '<!-- claude-coverage-comment -->')
else
  coverage_body=$(printf '%s\n## Test coverage\n\n| Package | Lines | Branches | Functions | Statements |\n|---|---|---|---|---|\n%s' \
    '<!-- claude-coverage-comment -->' "$coverage_rows")
fi
upsert_comment '<!-- claude-coverage-comment -->' "$coverage_body"
echo "[pr-ready] posted coverage comment"

echo "[pr-ready] flipping PR #$pr to ready..."
gh pr ready "$pr"
echo "[pr-ready] done."
