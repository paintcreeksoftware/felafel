#!/usr/bin/env bash
#
# Drift-check trigger for the memory-promoter subagent. Scans
# ~/.claude/projects/-workspaces-felafel/memory/ against the current
# state of .claude/agents/ and opens a draft PR if a memory rule has
# drifted enough to warrant promotion into (or update of) a subagent.
#
# Canonical trigger is implicit: when Claude Code's PR-lifecycle
# monitor observes a PR transition to MERGED, the running session
# invokes the memory-promoter agent inline (cheaper than spawning a
# new session — same context, same credentials, same memory dir).
#
# This script is the manual fallback. Use it when you want to force
# a drift check outside an active Claude session — e.g. from cron,
# or after a teammate's merge while your session was idle:
#
#   pnpm post-merge:sync
#
# Requires: `claude` CLI on PATH and a logged-in subscription/token.
# Exits 0 silently if `claude` is unavailable, so wiring this into a
# git hook on a machine without Claude installed is harmless.

set -euo pipefail

if ! command -v claude >/dev/null 2>&1; then
  echo "[post-merge:sync] claude CLI not on PATH; skipping drift check." >&2
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

claude -p --agent memory-promoter <<'PROMPT'
Run your standard drift-scan workflow:

1. Read every memory file under ~/.claude/projects/-workspaces-felafel/memory/
   (especially feedback_*).
2. For each rule, check whether the corresponding .claude/agents/*.md
   already encodes it (code-reviewer is the catch-all; topical agents
   own rules in their domain).
3. Classify each rule as: already-encoded / needs-update / new-rule /
   pattern-suggests-new-subagent.
4. If any high-confidence drift exists, open a draft PR on a new
   branch with the proposed agent edits; otherwise report the
   findings table inline and exit cleanly.
PROMPT
