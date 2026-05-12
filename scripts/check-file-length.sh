#!/usr/bin/env bash
# Source-file length cap enforcer. Walks the repo's source tree and exits
# non-zero if any file outside the allowlist exceeds the configured line
# cap. Hooked into pre-commit and CI so regressions can't land.
#
# Real implementation lands per PAI-140. This scaffold prints the audit
# (without erroring) so the framework + script wiring can be reviewed
# before the cap is flipped to hard-fail mode.

set -euo pipefail

readonly MAX_LINES=300
readonly IGNORE_FILE=".file-length-ignore"

# TODO(PAI-140): replace the warn-mode print with an exit-1 once the
# offenders identified in the ticket audit have been refactored.
find apps packages \
  -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/dist/*" \
  -not -path "*/out/*" \
  -not -path "*/release/*" \
  -not -path "*/.turbo/*" \
  -print0 |
  xargs -0 wc -l |
  awk -v max="$MAX_LINES" '$1 > max && $2 != "total" { print $1 "  " $2 }' |
  sort -rn ||
  true

echo
echo "scaffold mode — see ${IGNORE_FILE} for the allowlist and PAI-140 for the migration plan"
