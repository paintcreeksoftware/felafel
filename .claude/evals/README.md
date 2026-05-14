# Felafel evals

**Status: TODO — not implemented.**

This directory is reserved for Claude Code agent-behavior evals. They
do not exist yet. The gating conditions below describe **when** to
build them, not how.

## Why we need evals (worked example)

The recurrence shape evals catch is *"agent forgets a soft policy when
the policy isn't compiler-enforced."* It has already happened in this
repo at least once:

> **Drizzle migration with `<adjective>_<noun>` default name.**
> Agent generated a migration accepting Drizzle's default slug
> (`nervous_polaris`) instead of passing
> `--name workers_add_tailnet_serve_port`. Encoded in the
> `idiomatic-migration-names` memory rule and as a working agreement
> in `.claude/agents/code-reviewer.md`, but neither catches it at
> generation time. Only the next reader noticed.

Concrete eval for that shape:

```text
Eval: ask the agent to add a new column to the `workers` table.
Pass: command line contains `--name <descriptive_snake_case>` with a
      meaningful name (not `<adjective>_<noun>`).
Fail: command accepts default name OR uses a non-descriptive slug.
```

Other recurring shapes worth eval coverage once we build the harness:

- Agent uses `--no-verify` or `--no-gpg-sign` (memory rule says never).
- Agent forgets a regression test in the same PR as a behavior change.
- Agent creates `extends Error` for `instanceof`-only formatting (two
  overengineered patterns rule).
- Agent uses `pnpm dlx` when a `pnpm <script>` already exists
  (`use-package-scripts` rule).

## Gating: implement evals when ALL of these are true

1. **PAI-147 has been in use for ≥2 weeks** without structural churn
   to the subagents, slash commands, MCP servers, or hooks. If we're
   still adjusting the foundation, the eval baseline is moving.
2. **At least one PR has been completed start-to-finish by a
   downstream 15B-param coding model** using `checklist-generator`
   output. The eval suite serves the smaller-model pipeline; if no
   one's using that pipeline, evals serve no consumer.
3. **A specific regression has been observed** in production agent
   behavior post-stabilization — not from the historical examples
   above, but from agent runs that happen *after* (1) and (2). Evals
   exist to catch repeated failures; build them when there's a
   repeating failure to catch.

If any of these is false, skip evals. We're not optimizing for a
problem we don't have.

## Framework choice — deferred

Three reasonable directions; pick when (3) above tells us what shape
the eval needs:

- **Bash scripts** — cheap, manual, runs locally. Good if the eval
  count stays under ~10.
- **`promptfoo`** — community-standard eval framework. Good if the
  eval count grows or we want CI-scheduled runs.
- **Anthropic eval tooling** — first-party, integrates with the
  Anthropic API directly. Good if we move agent runtime onto the
  Anthropic platform's eval infrastructure.

## Files

This directory currently contains only this README. When evals land,
add a sibling `evals.json` (or `*.yaml`, framework-dependent) and a
`README.md` update describing the chosen framework + how to run them.
