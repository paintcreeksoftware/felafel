#!/usr/bin/env bash
#
# Dual-mode token-cost report for this repo's Claude Code sessions.
#
# Reports both numbers side-by-side: the user's actual marginal outlay
# (≈$0 on a Claude Max subscription) and the API-equivalent list-price
# counterfactual ("what would this have cost without the subscription").
# Wraps `ccusage` (https://github.com/ryoppippi/ccusage) which parses the
# session JSONL files Claude Code writes under ~/.claude/projects/.

set -euo pipefail

summary=$(npx -y ccusage@latest daily --json --no-offline 2>/dev/null)

input=$(jq -r '.totals.inputTokens' <<<"$summary")
output=$(jq -r '.totals.outputTokens' <<<"$summary")
cache_create=$(jq -r '.totals.cacheCreationTokens' <<<"$summary")
cache_read=$(jq -r '.totals.cacheReadTokens' <<<"$summary")
total_tokens=$(jq -r '.totals.totalTokens' <<<"$summary")
api_cost=$(jq -r '.totals.totalCost' <<<"$summary")

day_count=$(jq -r '.daily | length' <<<"$summary")
first=$(jq -r '.daily | first // {} | .date // "?"' <<<"$summary")
last=$(jq -r '.daily | last // {} | .date // "?"' <<<"$summary")

printf "Days: %s    Range: %s → %s\n\n" "$day_count" "$first" "$last"
printf "Tokens:           %15d input     /  %15d output\n" "$input" "$output"
printf "                  %15d cache-c.  /  %15d cache-r.\n" "$cache_create" "$cache_read"
printf "                  %15d total\n\n" "$total_tokens"
printf "Subscription:     \$%.2f marginal (covered by Claude Max)\n" "0.00"
printf "API-equivalent:   \$%.2f  (counterfactual list price — what you would\n" "$api_cost"
printf "                            pay per-token without the subscription)\n"
