<!--
Pull request template. GitHub pre-fills the description with this
content when you click "Create pull request" from a branch.

Linear auto-links the ticket if the branch name matches `PAI-NN-...`.
Including the URL in the body is still useful for reviewers without
a Linear account.

The self-review checklist below codifies the project's working
agreements. Tick what applies; mark "N/A" inline for items that
don't apply to this PR's scope. Don't delete the lines — leaving
them visible tells the reviewer what was considered.
-->

<!-- markdownlint-disable-next-line MD041 -->
## Summary

<!--
1–3 bullets covering what changed and why. Lead with the user-facing
or behavior-level outcome, not the file-by-file diff.
-->

-

## Linear ticket

<!-- e.g. PAI-99 — short title. Link to the issue page. -->

## Test plan

<!--
What was actually run (or what CI is expected to run) to verify this
change. Mark `[x]` for things done locally, leave `[ ]` for things
relying on CI.
-->

- [ ] `pnpm check-types && pnpm lint && pnpm test` green
- [ ] Husky pre-commit hooks green
- [ ] Behavior change has a regression test in this PR
  - (or: explicit reason no test needed — pure refactor / generated file / config-only)

## Self-review checklist

### Commits & PR shape

- [ ] Each commit ≤100 lines added+deleted (target ≤50); one logical change per commit
- [ ] Total PR diff ≤500–750 lines of reviewable code
  - (split into stacked or sequential PRs if larger; lockfiles and snapshots don't count)
- [ ] Branch name starts with `PAI-NN-…` matching the Linear ticket
  - (uppercase, no `ying/` prefix — branch protection requires it)

### Code quality

- [ ] TSDoc on every new class and exported method (`@param` / `@returns`, no carve-outs)
- [ ] No magic strings — repeated literals lifted to typed `const` objects
  - (`Platform`, `EnvVars`, `Tables`, …)
- [ ] No relative imports — always `@felafel/<pkg>/…`, never `./foo` or `../foo`
- [ ] No custom `extends Error` purely for `instanceof`-only formatting
- [ ] No `HttpStatus.OK`-style aliases for inline status literals
  - (use the literal + targeted `lint-disable` if needed)

### Libraries & tooling

- [ ] Established library used for any solved problem instead of hand-rolled
  - (execa, p-retry, …)
- [ ] Adapted to the chosen library's canonical conventions where they exist;
      deviations documented
- [ ] Style issues that recur become lint rules, not one-off fixes
- [ ] Commands use `pnpm --filter <pkg> <script>` — no `pnpm dlx`, no direct
      `node_modules/.bin/…` paths; if no script exists, one was added in the
      same change

### Schema & service design

- [ ] If a DB table changed: uniform `id` integer PK + `createdAt`;
      external/wire IDs live in their own `UNIQUE NOT NULL` columns
      (DB row identity ≠ business identity)
- [ ] If service-level shape changed: 12-factor audited, deviations called
      out below (distinguish v0 shortcuts from structural constraints)

### Metadata

- [ ] `package.json#description` updated for any package whose capability
      surface changed (architecture shift, new top-level capability, removed
      capability, tech stack shift at the boundary, mode change).
  - N/A for bug fixes / internal refactors / dep swaps / doc-only / tests / lint
- [ ] If pushing additional commits after PR is open: refresh this PR
      description so it doesn't drift from what's on the branch

## 12-factor deviations

<!--
List any factors this PR knowingly violates and why (v0 shortcut /
structural constraint / external requirement). Write "N/A" if the
PR is unrelated to service shape.
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
