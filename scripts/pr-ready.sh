#!/usr/bin/env bash
#
# pr-ready.sh — flip a draft PR to ready, after posting a cost-summary
# comment and a memory-drift comment to the PR. Atomic: every step
# succeeds before the ready flip, or the PR stays draft. Idempotent:
# re-running edits the existing marker comments in place rather than
# appending duplicates.
#
# Usage:  pnpm pr:ready <PR_NUMBER>
#         scripts/pr-ready.sh <PR_NUMBER>
#
# Comment shape (one per kind, identified by a hidden HTML marker on
# the first line so subsequent runs find + update in place):
#
#   <!-- claude-cost-comment -->
#   ## Cost summary
#
#   ```
#   <output of scripts/cost.sh --since HEAD>
#   ```
#
#   <!-- claude-drift-comment -->
#   ## Memory drift snapshot
#
#   ```
#   <memory-promoter findings table>
#   ```
#
# The PR body is left alone. Previously this script stamped marker
# zones into the body and a CI workflow lifted them into a comment;
# that produced "stamped twice" output (body + comment for drift, raw
# block + synthesized section for cost). Both CI workflows are
# retired in the same PR as this refactor.

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
cost=$(bash scripts/cost.sh --since HEAD)
if [ -z "$cost" ]; then
  echo "ERROR: scripts/cost.sh returned empty output; aborting" >&2
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
drift_body=$(printf '%s\n## Memory drift snapshot\n\n```\n%s\n```' "$drift_marker" "$drift")
upsert_comment "$drift_marker" "$drift_body"
echo "[pr-ready] posted drift comment"

echo "[pr-ready] flipping PR #$pr to ready..."
gh pr ready "$pr"
echo "[pr-ready] done."
