<!--
Pull request template. GitHub pre-fills the description with this
content when you click "Create pull request" from a branch.

Linear auto-links the ticket if the branch name matches `PAI-NN-...`.
Including the URL in the body is still useful for reviewers without a
Linear account.

Working agreements live where they're enforced — do not restate them
in the PR body:

  - `.husky/pre-commit` enforces commit-line-cap, lint, type-check,
    tests, markdownlint, shellcheck, Drizzle drift, export-coverage,
    knip. If a check fires, the underlying issue gets fixed;
    pre-commit is never bypassed with `--no-verify`.
  - `.claude/agents/code-reviewer.md` encodes the judgement-level
    rules (atomic semantic seams, PR LOC cap, the two overengineered
    patterns to avoid, DB identity, 12-factor audit, testing
    discipline, etc.). Run the code-reviewer subagent against the PR
    before flipping it out of draft.
-->

<!-- markdownlint-disable-next-line MD041 -->
## Summary

<!--
1–3 bullets covering what changed and why. Lead with the user-facing
or behavior-level outcome, not the file-by-file diff.
-->

-

## Linear ticket

<!-- e.g. PAI-99 — short title. Linear auto-links from `PAI-NN-*` branches. -->

## Test plan

<!--
Verification BEYOND what pre-commit + CI already cover. Usually
empty / N/A — most PRs don't need anything here. List only
PR-specific manual checks the reviewer would otherwise have no way
to know about.
-->

- [ ] code-reviewer subagent run; findings addressed or N/A'd inline

## 12-factor deviations

<!--
List any factors this PR knowingly violates and why (v0 shortcut /
structural constraint / external requirement). Write "N/A" if the PR
is unrelated to service shape.
-->

N/A

## Notes for reviewer

<!--
Anything the diff doesn't make obvious: trade-offs considered,
alternatives rejected, follow-up work tracked elsewhere. Keep it
short — the goal is to surface what a careful reader would otherwise
miss.
-->

N/A

<!--
Cost summary + memory-drift snapshot are posted as PR comments by
`pnpm pr:ready <N>` at flip-to-ready time (`scripts/pr-ready.sh`).
The PR body intentionally stays clean.
-->
