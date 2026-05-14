#!/usr/bin/env bash
#
# Stop hook — runs when the Claude Code agent finishes a turn.
# Surfaces three things the agent should know but routinely forgets to
# check: where the working branch is relative to origin/main, what the
# last commit was, and whether any open PR for this branch is BEHIND
# (the canonical mergeStateStatus that says rebase before more commits).
#
# Wired in .claude/settings.json under hooks.Stop. Output goes to
# stdout and the harness surfaces it in the chat.
#
# Performance: the `gh pr list` call adds ~0.5–1s of latency on every
# agent turn. Tolerable for the value of catching BEHIND state
# immediately. If it becomes a bottleneck, the rebase check can be
# made conditional (e.g. only when there's an open PR for the branch).

set -e

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

branch=$(git branch --show-current 2>/dev/null || echo "(detached)")
last=$(git log -1 --format='%h %s' 2>/dev/null || echo "(no commits)")

# Ahead/behind vs upstream.
upstream_info=""
if git rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
  read -r ahead behind <<<"$(git rev-list --left-right --count 'HEAD...@{upstream}' 2>/dev/null || echo '0 0')"
  if [ "$ahead" = "0" ] && [ "$behind" = "0" ]; then
    upstream_info="in sync"
  elif [ "$ahead" != "0" ] && [ "$behind" = "0" ]; then
    upstream_info="ahead by $ahead"
  elif [ "$ahead" = "0" ] && [ "$behind" != "0" ]; then
    upstream_info="BEHIND upstream by $behind — push or pull"
  else
    upstream_info="DIVERGED — ahead $ahead, behind $behind"
  fi
else
  upstream_info="no upstream"
fi

# Open-PR rebase state, only meaningful off main.
pr_info=""
if [ "$branch" != "(detached)" ] && [ "$branch" != "main" ]; then
  pr_info=$(gh pr list --head "$branch" --state open \
    --json number,mergeStateStatus,isDraft \
    --jq '.[] | "  PR #\(.number) (\(if .isDraft then "draft" else "ready" end)) mergeState=\(.mergeStateStatus)"' \
    2>/dev/null || true)
fi

echo "[stop] branch=$branch  $upstream_info"
echo "[stop] last: $last"
if [ -n "$pr_info" ]; then
  echo "$pr_info"
fi
