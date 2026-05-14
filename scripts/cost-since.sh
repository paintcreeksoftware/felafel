#!/usr/bin/env bash
#
# Cost report for sessions since the given git ref was branched off main.
# Usage: scripts/cost-since.sh [<ref>]   (default: current HEAD)
#
# Computes the merge-base of <ref> with main, takes that commit's
# timestamp as the lower bound, and filters ccusage to that window.
# Answers "what did this branch cost?" without depending on reflog (which
# is local-only and lost on rebase).

set -euo pipefail

ref="${1:-HEAD}"
base=$(git merge-base "$ref" main 2>/dev/null || git merge-base "$ref" origin/main)
ts_iso=$(git show -s --format=%cI "$base")
ts_date=$(date -d "$ts_iso" +%Y%m%d 2>/dev/null || \
          date -j -f "%Y-%m-%dT%H:%M:%S%z" "$ts_iso" +%Y%m%d)

summary=$(npx -y ccusage@latest daily --since "$ts_date" --json --no-offline 2>/dev/null)

input=$(jq -r '.totals.inputTokens' <<<"$summary")
output=$(jq -r '.totals.outputTokens' <<<"$summary")
total_tokens=$(jq -r '.totals.totalTokens' <<<"$summary")
api_cost=$(jq -r '.totals.totalCost' <<<"$summary")

printf "Cost since %s (branched at %s):\n\n" "$ref" "$ts_iso"
printf "Tokens:           %15d input  /  %15d output  /  %15d total\n" \
       "$input" "$output" "$total_tokens"
printf "Subscription:     \$%.2f marginal\n" "0.00"
printf "API-equivalent:   \$%.2f\n" "$api_cost"
