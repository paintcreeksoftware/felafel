#!/usr/bin/env bash
#
# pr-ready.sh — flip a draft PR to ready, after stamping a cost block
# and a memory-drift snapshot into its body. Atomic: every step
# succeeds before the ready flip, or the PR stays draft. Idempotent:
# re-running replaces the marker zones in place rather than appending.
#
# Usage:  pnpm pr:ready <PR_NUMBER>
#         scripts/pr-ready.sh <PR_NUMBER>
#
# Marker schema (consumed by .github/workflows/*.yml — PAI-166):
#
#   <!-- claude-cost-block:start -->
#   ```
#   <output of scripts/cost.sh --since HEAD>
#   ```
#   <!-- claude-cost-block:end -->
#
#   <!-- claude-drift-snapshot:start -->
#   ```
#   <memory-promoter findings table>
#   ```
#   <!-- claude-drift-snapshot:end -->
#
# Empty marker pairs are pre-seeded in .github/PULL_REQUEST_TEMPLATE.md
# so a fresh PR has a target zone for the splice. The cost portion
# delegates to scripts/stamp-pr-cost.sh; the drift portion is local.

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

echo "[pr-ready] stamping cost block onto PR #$pr..."
bash scripts/stamp-pr-cost.sh "$pr"

echo "[pr-ready] computing memory-drift snapshot..."
drift=$(claude -p --agent memory-promoter <<'PROMPT'
Output a single compact findings table — one row per memory rule with
columns: rule | state (encoded / needs-update / new / suggests-subagent)
| target agent file. No prose, no PR-opening, no edits. Plain text only,
suitable for embedding in a PR body.
PROMPT
)
if [ -z "$drift" ]; then
  echo "ERROR: memory-promoter returned empty snapshot; aborting" >&2
  exit 1
fi

echo "[pr-ready] splicing drift snapshot into PR #$pr body..."
body=$(gh pr view "$pr" --json body -q .body)
block=$(cat <<EOF
<!-- claude-drift-snapshot:start -->
\`\`\`
$drift
\`\`\`
<!-- claude-drift-snapshot:end -->
EOF
)
if grep -q "<!-- claude-drift-snapshot:start -->" <<<"$body"; then
  body=$(awk -v block="$block" '
    /<!-- claude-drift-snapshot:start -->/{print block; flag=1; next}
    /<!-- claude-drift-snapshot:end -->/{flag=0; next}
    !flag
  ' <<<"$body")
else
  body=$(printf '%s\n\n%s\n' "$body" "$block")
fi
gh pr edit "$pr" --body "$body" > /dev/null

echo "[pr-ready] flipping PR #$pr to ready..."
gh pr ready "$pr"
echo "[pr-ready] done."
