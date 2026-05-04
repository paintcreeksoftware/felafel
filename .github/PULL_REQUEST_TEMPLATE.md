<!--
Pull request template. GitHub pre-fills the description with this
content when you click "Create pull request" from a branch.

Linear auto-links the ticket if the branch name matches `PAI-NN-...`.
Including the URL in the body is still useful for reviewers without
a Linear account.
-->

<!-- markdownlint-disable-next-line MD041 -->
## Summary

<!--
1–3 bullets covering what changed and why. Lead with the user-facing
or behavior-level outcome, not the file-by-file diff.
-->

-

## Linear ticket

<!-- e.g. PAI-99 — short title. Link to the issue. -->

## Test plan

<!--
Checklist of what you ran (or expect CI to run) to verify this
change. Mark `[x]` for things done locally, `[ ]` for things you're
relying on CI for.
-->

- [ ] `pnpm check-types && pnpm lint && pnpm test`
- [ ] Husky pre-commit hooks green
- [ ]
