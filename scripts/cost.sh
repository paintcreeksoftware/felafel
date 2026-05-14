#!/usr/bin/env bash
#
# Token-cost report for this repo's Claude Code sessions. Always
# dual-mode: actual marginal outlay (≈$0 on Claude Max) shown
# side-by-side with the counterfactual API-equivalent list price.
#
# Usage:
#   scripts/cost.sh                  # cumulative across all sessions
#   scripts/cost.sh --since          # since current HEAD's branch-point
#   scripts/cost.sh --since <ref>    # since <ref>'s branch-point on main
#
# Wraps `ccusage` (https://github.com/ryoppippi/ccusage), which parses
# the session JSONL files Claude Code writes under ~/.claude/projects/.

set -euo pipefail

mode="cumulative"
ref=""
while [ $# -gt 0 ]; do
  case "$1" in
    --since)
      mode="since"
      if [ -n "${2-}" ] && [ "${2#--}" = "$2" ]; then
        ref="$2"
        shift 2
      else
        ref="HEAD"
        shift 1
      fi
      ;;
    *)
      echo "Unknown arg: $1" >&2
      echo "Usage: $0 [--since [<ref>]]" >&2
      exit 2
      ;;
  esac
done

ccusage_args=(daily --json --no-offline)
since_label=""
if [ "$mode" = "since" ]; then
  base=$(git merge-base "$ref" main 2>/dev/null || git merge-base "$ref" origin/main)
  ts_iso=$(git show -s --format=%cI "$base")
  ts_date=$(date -d "$ts_iso" +%Y%m%d 2>/dev/null || \
            date -j -f "%Y-%m-%dT%H:%M:%S%z" "$ts_iso" +%Y%m%d)
  ccusage_args+=(--since "$ts_date")
  since_label="$ref (branched at $ts_iso)"
fi

summary=$(npx -y ccusage@latest "${ccusage_args[@]}" 2>/dev/null)

input=$(jq -r '.totals.inputTokens'           <<<"$summary")
output=$(jq -r '.totals.outputTokens'         <<<"$summary")
cache_create=$(jq -r '.totals.cacheCreationTokens' <<<"$summary")
cache_read=$(jq -r '.totals.cacheReadTokens'  <<<"$summary")
total_tokens=$(jq -r '.totals.totalTokens'    <<<"$summary")
api_cost=$(jq -r '.totals.totalCost'          <<<"$summary")

day_count=$(jq -r '.daily | length'                       <<<"$summary")
first=$(jq -r    '.daily | first // {} | .date // "?"'    <<<"$summary")
last=$(jq -r     '.daily | last  // {} | .date // "?"'    <<<"$summary")

if [ -n "$since_label" ]; then
  printf "Cost since %s\n\n" "$since_label"
else
  printf "Cumulative cost (all sessions)\n\n"
fi
printf "Days: %s    Range: %s → %s\n\n" "$day_count" "$first" "$last"
printf "Tokens:           %15d input     /  %15d output\n" "$input" "$output"
printf "                  %15d cache-c.  /  %15d cache-r.\n" "$cache_create" "$cache_read"
printf "                  %15d total\n\n" "$total_tokens"
printf "Subscription:     \$%.2f marginal (covered by Claude Max)\n" "0.00"
printf "API-equivalent:   \$%.2f  (counterfactual list price)\n" "$api_cost"
