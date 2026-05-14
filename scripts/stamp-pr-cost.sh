#!/usr/bin/env bash
#
# Stamp a `<!-- claude-cost-block --> ... <!-- /claude-cost-block -->`
# section into a PR's body, populated with the output of
# `scripts/cost-since.sh HEAD`. Idempotent — replaces an existing
# block in place rather than appending a duplicate.
#
# Usage: scripts/stamp-pr-cost.sh <pr-number>
#
# Intended to run from the agent's PR-ready flow (right before
# `gh pr ready <pr>`) so the merge-time Linear-comment workflow has
# a cost block to lift. The workflow is defined in
# `.github/workflows/linear-ticket-cost.yml`.

set -euo pipefail

pr="${1:?usage: stamp-pr-cost.sh <pr-number>}"

cost=$(bash scripts/cost.sh --since HEAD)

block=$(cat <<EOF
<!-- claude-cost-block:start -->
\`\`\`
$cost
\`\`\`
<!-- claude-cost-block:end -->
EOF
)

current_body=$(gh pr view "$pr" --json body -q .body)

if grep -q "<!-- claude-cost-block:start -->" <<<"$current_body"; then
  # Replace the existing block in place.
  new_body=$(awk -v block="$block" '
    /<!-- claude-cost-block:start -->/{print block; in_block=1; next}
    /<!-- claude-cost-block:end -->/{in_block=0; next}
    !in_block
  ' <<<"$current_body")
else
  # Append, separated by a blank line.
  new_body=$(printf '%s\n\n%s\n' "$current_body" "$block")
fi

gh pr edit "$pr" --body "$new_body" > /dev/null
echo "Stamped cost block onto PR #$pr"
