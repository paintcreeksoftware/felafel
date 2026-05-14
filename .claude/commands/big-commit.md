---
description: Commit with ALLOW_BIG_COMMIT=1 to bypass the 100-line cap (budget 2 per PR, enforced by .husky/pre-commit)
argument-hint: <conventional-commits message>
---

The user has invoked `/big-commit` because the staged change exceeds the
project's 100-line hard cap on a single commit. Before running the
bypass:

1. **Inspect the staged diff** with `git diff --cached --shortstat -M70%`
   and `git diff --cached --stat`. Confirm the change is genuinely
   irreducible — a single semantic unit that cannot be split along a
   semantic seam without creating artificial seams (e.g. a single new
   README, a generated migration file, a large rename without enough
   import-line overlap for `-M70%` to fold it).
2. **If the change can be split**, propose the split to the user
   instead of using the bypass. The over-cap budget is rationed (2 per
   PR by default) precisely so it stays the exception, not the routine.
3. **If the change is genuinely atomic**, run:

   ```bash
   ALLOW_BIG_COMMIT=1 git commit -m "<message from $ARGUMENTS>"
   ```

   The husky pre-commit hook (`.husky/pre-commit`) counts existing
   over-cap commits on the branch and will reject if the budget is
   already exhausted. You don't need to compute the budget yourself —
   the hook reports `[hook] big-commit slot used: N/2 ...` on success.

The commit message in `$ARGUMENTS` must follow the project's
Conventional Commits convention (type-enum: `build`, `chore`, `ci`,
`docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`)
with **lowercase** subject and body lines wrapped at 100 chars. The
commit body should explain *why* the bypass is appropriate for this
specific change (which semantic-seam alternatives were considered and
rejected).
