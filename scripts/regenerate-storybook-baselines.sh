#!/usr/bin/env bash
#
# regenerate-storybook-baselines.sh — refresh apps/storybook/__snapshots__/
# inside the same Playwright container CI uses, so the local-vs-CI
# font rendering diff doesn't fire false positives.
#
# When to run: after any intentional visual change (new story, new
# Tailwind token, primitive style update). Inspect the diff before
# committing.
#
# When NOT to run: never bypass a real visual regression by
# regenerating. If a snapshot diff fires on a PR you didn't intend
# to change, find the cause first.
#
# Usage:  pnpm storybook:regen-baselines
#         bash scripts/regenerate-storybook-baselines.sh

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
# Tag must track apps/storybook/devDependencies → @storybook/test-runner's
# resolved Playwright version. Pin in lockstep with the workflow at
# .github/workflows/storybook.yml.
image="mcr.microsoft.com/playwright:v1.59.1-jammy"

cd "$repo_root"
rm -rf apps/storybook/__snapshots__ apps/storybook/storybook-static

docker run --rm -v "$repo_root:/workspace" -w /workspace -e CI=true "$image" bash -c '
  corepack enable >/dev/null
  pnpm install --frozen-lockfile
  pnpm --filter @felafel/storybook build-storybook
  pnpm --filter @felafel/storybook test:storybook:ci
'

# Container ran as root; chown back so git sees the changes as
# user-owned and the build artifact can be cleaned without sudo.
docker run --rm -v "$repo_root:/workspace" -w /workspace "$image" \
  chown -R 1000:1000 apps/storybook/__snapshots__ apps/storybook/storybook-static
rm -rf apps/storybook/storybook-static

echo "Done. git status to inspect; commit the __snapshots__/ deltas if intentional."
