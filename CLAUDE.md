# Felafel

Felafel is the working name of **Paint Creek Software's local-first
software factory** — a single-tenant rig for agentic coding,
computer-use, and long-running parallel sub-agents across machines
linked by a Tailnet, with a swappable inference backend (frontier API
now, self-hosted GPU later). The broader architectural trajectory
(inference gateway, MCP tool layer, sandboxes, web GUI, eventual
Wayland host computer-use) lives in the
[Local-First Software Factory](https://linear.app/paint-creek-software/project/local-first-software-factory-f03283e104a5)
Linear project. This repository realizes the **desktop entry-point**
and **Hono orchestrator** slices of that vision today.

This file is also auto-loaded into every Claude Code session for this
repo, so the same orientation lands for human contributors and for
agents.

## Stack

```text
Electron 41 (desktop shell)
├── electron-vite 5 (bundler)
│   └── Vite 7
├── React 19.2 (renderer)
│   ├── shadcn/ui (Radix + Tailwind primitives)
│   └── Tailwind CSS 4
└── Node 24 (main process)

Hono 4 (orchestrator HTTP service)
├── @hono/zod-openapi (typed routes + contracts)
└── @hono/node-server

Drizzle ORM (1.0 rc) (data layer)
└── node:sqlite (driver, no native deps)

Tailscale (transport)
└── host CLI via @felafel/tailscale (no JS/TS SDK; shells the CLI)

pnpm 10 + turbo (workspace + task orchestration)
vitest 4 (unit) + Playwright (E2E, xvfb on Linux CI)
```

## Repo layout

- `apps/desktop/` — Electron app (main + preload + React renderer)
- `apps/orchestrator/` — Hono service, bundled with the desktop and
  also shipped as a Docker image for remote deployment
- `apps/worker/` — Node daemon that registers with the orchestrator
  and runs dispatched jobs
- `packages/db/` — Drizzle schema + queries (SQLite via `node:sqlite`)
- `packages/contracts/` — Zod schemas + wire types shared between
  orchestrator and worker
- `packages/shared/` — IPC channel names + wire shapes shared between
  main and renderer
- `packages/tailscale/` — host-CLI wrapper + status pill (Node side,
  React UI under sub-path exports)
- `packages/ui/` — shadcn-derived UI primitives consumed by every
  app's renderer

## Prerequisites

The expected developer environment is the **Dev Container** defined
in `.devcontainer/devcontainer.json`. Open the cloned repo in VS Code
with the **Dev Containers** extension and the container handles the
host-side environment automatically — including `setup.sh` via its
`postCreateCommand` (which raises inotify limits and installs
shellcheck for the husky hook).

Host requirements (outside the container):

- **VS Code** with the **Dev Containers** extension
- **Docker** (the Dev Container runs in it)
- **Tailscale CLI** on the host (the `@felafel/tailscale` package
  shells out to it; no JS/TS SDK exists)
- **Linux** or **macOS** (Windows currently untested)

Everything provisioned inside the container — the base image, the
`features` block, and what `postCreateCommand: bash setup.sh` adds —
is defined in [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json).
Read that file (and `setup.sh`) for the authoritative list rather
than trusting an enumeration here that will drift.

## Installation

```bash
git clone git@github.com:paintcreeksoftware/felafel.git
cd felafel
# Open in VS Code → "Reopen in Container". The Dev Container's
# postCreateCommand runs setup.sh. Then, inside the container shell:
pnpm install
pnpm --filter @felafel/desktop dev    # boots Electron + orchestrator
```

The `dev` script in `apps/desktop` rebuilds `@felafel/orchestrator`
before launching `electron-vite dev`, so a single command boots the
full local stack. Database migrations are applied automatically on
orchestrator startup (see [`packages/db/src/client.ts`](packages/db/src/client.ts)),
so there is no separate `db:migrate` step on fresh clone.

## Roadmap

Current and queued work is tracked in the
[**Linear PAI team board**](https://linear.app/paint-creek-software/team/PAI).
Filter by `status: Backlog` for "what's queued" and
`status: In Progress` for "what's actively being worked". Branches
follow the `PAI-NN-<kebab-title>` convention so tickets and diffs stay
linked.

For agents: the `mcp__claude_ai_Linear__list_issues` tool with
`team: "PAI"` and a status filter is the source of truth — not
anything in this file.

## Cost / FinOps

The session-level token cost is visible in-CLI via the built-in
`/cost` slash command. Cross-session aggregation tooling (a
`pnpm cost:report` wrapper around `ccusage`, plus per-ticket cost
comments on Linear when a PR merges) is being added incrementally —
see the PAI-147 ticket for the rollout.

## Where the working agreements live

The commit-shape, branch-naming, code-style, library-choice, and
review rules **are not duplicated here**. They live where they are
enforced:

- **`.husky/pre-commit`** — lint, type-check, tests, markdownlint,
  shellcheck, Drizzle drift, export-coverage, knip. If a check fires,
  the underlying issue gets fixed; pre-commit is never bypassed with
  `--no-verify`.
- **`.github/PULL_REQUEST_TEMPLATE.md`** — the per-PR self-review
  surface, including the `code-reviewer` subagent sign-off line.
- **`.claude/agents/code-reviewer.md`** — the system-prompted subagent
  that encodes the judgment-level rules (atomic commits, PR LOC cap,
  the two overengineered patterns to avoid, lint determinism, DB
  identity, 12-factor service-design audit, testing discipline, etc.).
  Run it before flipping a PR out of draft.
- **`~/.claude/projects/-workspaces-felafel/memory/`** — per-developer
  preferences (cadence, style, tool-use patterns) that do not apply to
  all contributors. Not checked in.

When a working agreement changes, update the surface that enforces it,
not this README.

## When you encounter unfamiliar state

Investigate before deleting or overwriting. Unfamiliar files,
branches, or configuration may be an in-progress change you have not
seen yet. Resolve merge conflicts rather than discarding work. If a
lock file or process artefact exists, find out what holds it rather
than removing it.
