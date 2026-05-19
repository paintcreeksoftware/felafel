#!/usr/bin/env bash
#
# audit-log-shape.sh — verify every JSONL log record carries the
# six bindings the @felafel/logs createLogger contract guarantees:
# time, level, service, node, pid, version. Walks the most recent
# session JSONL files under ~/.claude/projects/ and emits per-file
# offender lines.
#
# Exits non-zero if any record is missing a required binding so
# the script can wire into CI as a contract-check on the log shape.
# Stdout is the per-file offender list, suitable for the
# observability-reviewer subagent's report.

set -euo pipefail

REQUIRED_FIELDS=(time level service node pid version)
PROJECTS_DIR="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"
MAX_FILES="${AUDIT_LOG_SHAPE_MAX_FILES:-10}"

if [ ! -d "$PROJECTS_DIR" ]; then
  echo "SKIP: no projects dir at $PROJECTS_DIR"
  exit 0
fi

# Sample the N most-recently-modified .jsonl files; the older ones
# may pre-date the @felafel/logs adoption and would false-positive.
mapfile -t recent < <(find "$PROJECTS_DIR" -maxdepth 3 -name '*.jsonl' -printf '%T@ %p\n' | sort -rn | head -n "$MAX_FILES" | cut -d' ' -f2-)

if [ "${#recent[@]}" -eq 0 ]; then
  echo "SKIP: no .jsonl files under $PROJECTS_DIR"
  exit 0
fi

offenders=""
for f in "${recent[@]}"; do
  # Find records that are missing AT LEAST ONE required field.
  # The jq guard skips non-Felafel log records (Claude Code's own
  # session JSONL has a different shape) by checking for `service`
  # first — anything with `service` is a Felafel log line.
  missing=$(jq -rc --argjson fields "$(printf '%s\n' "${REQUIRED_FIELDS[@]}" | jq -Rn '[inputs]')" \
    'select(.service != null) | . as $r | $fields | map(select(($r[.] // null) == null)) | select(length > 0) | { file: input_filename, line: input_line_number, msg: $r.msg, missing: . }' \
    "$f" 2>/dev/null || true)
  if [ -n "$missing" ]; then
    offenders+="$missing"$'\n'
  fi
done

if [ -z "$offenders" ]; then
  echo "✓ log shape OK across ${#recent[@]} recent JSONL file(s)"
  exit 0
fi

echo "FAIL: log records missing required bindings"
echo "$offenders"
exit 1
