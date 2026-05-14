#!/usr/bin/env bash
#
# Prune stale `PAI-*` branches — local by default, remote with opt-in.
#
# A branch is "stale" iff its associated PR is MERGED or CLOSED. Local
# pruning is unconditional once that's true (the branch only lives on
# this machine). Remote pruning is destructive on shared state, so it
# is dry-run by default and only commits with `--remote --force`.
#
# Usage:
#   scripts/prune-stale-branches.sh                 # local only (default)
#   scripts/prune-stale-branches.sh --remote        # local + remote dry-run
#   scripts/prune-stale-branches.sh --remote --force  # local + remote real
#
# Safety reasoning (mirrors feedback_prune_stale_local_branches.md):
#
#   Local — delete iff BOTH:
#     - `git ls-remote --heads origin <branch>` returns nothing (the
#       remote ref is gone, typically auto-deleted on PR merge), AND
#     - `gh pr list --head <branch> --state all` returns MERGED or
#       CLOSED.
#   Leave alone when ANY of:
#     - PR is OPEN (active work even if unrecognized)
#     - PR is NONE (no PR yet — could be unpushed WIP)
#     - Remote still exists (someone else may still be using it)
#     - It's the current branch
#   `branch -D` (not `-d`) because squash-merge leaves the branch
#   looking "not merged" to git; the remote-gone + PR-state check is
#   what makes -D safe.
#
#   Remote — delete iff PR is MERGED or CLOSED AND closed at least
#   $REMOTE_STALE_DAYS ago (default 1). The age gate avoids racing
#   GitHub's own auto-delete-on-merge. Dry-run by default; `--force`
#   actually runs `git push origin --delete`. `main` is always
#   excluded.
#
# Requires: gh CLI, jq, git. Run from anywhere inside the repo.

set -euo pipefail

# ---- arg parsing ----
remote_mode=0
force=0
while [ $# -gt 0 ]; do
  case "$1" in
    --remote) remote_mode=1; shift ;;
    --force)  force=1; shift ;;
    -h|--help)
      sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ---- preconditions ----
for bin in git gh jq; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: $bin not on PATH" >&2
    exit 1
  fi
done

REMOTE_STALE_DAYS="${REMOTE_STALE_DAYS:-1}"
current=$(git branch --show-current)

# Refresh local view of remote refs so subsequent ls-remote / pr lookups
# are consistent. `--prune` drops local tracking refs whose origin
# branch is gone.
git fetch --prune origin --quiet

# ---- local pass ----
echo "== Local PAI-* branches =="
deleted_local=0
kept_local=0
while IFS= read -r b; do
  [ -z "$b" ] && continue
  if [ "$b" = "$current" ]; then
    echo "  skip $b (current branch)"
    kept_local=$((kept_local + 1))
    continue
  fi
  if [ -n "$(git ls-remote --heads origin "$b" 2>/dev/null)" ]; then
    echo "  keep $b (remote still exists)"
    kept_local=$((kept_local + 1))
    continue
  fi
  state=$(gh pr list --head "$b" --state all --json state \
    --jq '.[0].state // "NONE"' 2>/dev/null || echo "NONE")
  case "$state" in
    MERGED|CLOSED)
      git branch -D "$b" >/dev/null
      echo "  del  $b (PR $state, remote gone)"
      deleted_local=$((deleted_local + 1))
      ;;
    OPEN)
      echo "  keep $b (PR OPEN)"
      kept_local=$((kept_local + 1))
      ;;
    *)
      echo "  keep $b (no PR yet — possible WIP)"
      kept_local=$((kept_local + 1))
      ;;
  esac
done < <(git branch --list 'PAI-*' --format='%(refname:short)')
echo "  -> deleted $deleted_local, kept $kept_local"

# ---- remote pass (opt-in) ----
if [ "$remote_mode" -eq 0 ]; then
  echo ""
  echo "Remote pruning skipped. Re-run with --remote (dry-run) or"
  echo "--remote --force (real deletion) to clean stale origin refs."
  exit 0
fi

echo ""
if [ "$force" -eq 1 ]; then
  echo "== Remote origin/PAI-* branches (LIVE) =="
else
  echo "== Remote origin/PAI-* branches (dry-run) =="
fi

now_epoch=$(date -u +%s)
cutoff_secs=$((REMOTE_STALE_DAYS * 86400))
deleted_remote=0
kept_remote=0
while IFS= read -r ref; do
  b="${ref#refs/heads/}"
  [ "$b" = "main" ] && continue
  case "$b" in PAI-*) ;; *) continue ;; esac

  pr_json=$(gh pr list --head "$b" --state all \
    --json state,closedAt --jq '.[0]' 2>/dev/null || echo "")
  if [ -z "$pr_json" ] || [ "$pr_json" = "null" ]; then
    echo "  keep origin/$b (no PR — possible active branch)"
    kept_remote=$((kept_remote + 1))
    continue
  fi
  state=$(jq -r '.state'    <<<"$pr_json")
  closed=$(jq -r '.closedAt // empty' <<<"$pr_json")
  if [ "$state" != "MERGED" ] && [ "$state" != "CLOSED" ]; then
    echo "  keep origin/$b (PR $state)"
    kept_remote=$((kept_remote + 1))
    continue
  fi
  if [ -z "$closed" ]; then
    echo "  keep origin/$b (PR $state, no closedAt)"
    kept_remote=$((kept_remote + 1))
    continue
  fi
  closed_epoch=$(date -u -d "$closed" +%s 2>/dev/null \
    || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$closed" +%s)
  age=$((now_epoch - closed_epoch))
  if [ "$age" -lt "$cutoff_secs" ]; then
    echo "  keep origin/$b (PR $state but closed <${REMOTE_STALE_DAYS}d ago)"
    kept_remote=$((kept_remote + 1))
    continue
  fi
  if [ "$force" -eq 1 ]; then
    git push origin --delete "$b" >/dev/null
    echo "  del  origin/$b (PR $state, closed $closed)"
  else
    echo "  would-del origin/$b (PR $state, closed $closed)"
  fi
  deleted_remote=$((deleted_remote + 1))
done < <(git ls-remote --heads origin | awk '{print $2}')

if [ "$force" -eq 1 ]; then
  echo "  -> deleted $deleted_remote, kept $kept_remote"
else
  echo "  -> would delete $deleted_remote, kept $kept_remote"
  echo ""
  echo "Re-run with --remote --force to actually delete."
fi
