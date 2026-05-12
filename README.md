<p align="center">
  <img src="./felafel.png" alt="Felafel logo" width="200" />
</p>

# Felafel

Electron desktop application built on a Turborepo workspace, with an embedded
Hono orchestrator service and a Vite + React + Tailwind renderer.

## Layout

```text
apps/
  desktop/        Electron app (main + preload + renderer)
  orchestrator/   Hono service spawned by desktop in dev/embedded mode;
                  also shipped as a Docker image for remote deployment
packages/
  shared/         IPC channel names + worker schemas shared across processes
```

## Development workflow

The repo ships two configs that work **together** day-to-day, not as
alternatives:

| Environment | Where it runs | What you do in it |
| --- | --- | --- |
| **Dev Container** ([`.devcontainer/`](.devcontainer/)) | VS Code reopens the workspace inside it. Cross-platform. | Edit code, run Claude Code, lint, typecheck, build, package, git |
| **Distrobox** ([`distrobox.ini`](distrobox.ini)) | A separate shell on the host (Linux only). Has display + audio access. | Run `pnpm dev` to actually launch the Electron window |

They share `$HOME`, so the repo, `node_modules`, and orchestrator data are
visible to both — `pnpm install` in either env satisfies the other. You'd typically have
a VS Code window (Dev Container) open for editing and a side-by-side host
terminal (Distrobox) running `pnpm dev`.

### Prerequisites on the host

- git
- Linux with X11 or Wayland — for the Distrobox path
- [Distrobox](https://distrobox.it) (preinstalled on Bluefin DX and most
  ublue-os atomic distros)
- VS Code + [Dev Containers
  extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers),
  or GitHub Codespaces (which ships its own)
- A container runtime for local Dev Containers (Docker Desktop, Podman,
  OrbStack); not needed in Codespaces

## First-time setup

Each step calls out which environment you run it in. Don't skip ahead — step 4
needs the Distrobox to exist, step 5 needs VS Code in the container, etc.

### Step 1 — Clone the repo (on the host)

In a host terminal:

```sh
git clone git@github.com:paintcreeksoftware/felafel.git
cd felafel
```

Clone into a directory under your `$HOME`. Distrobox bind-mounts `$HOME` into
the container, so anything outside it (`/opt`, `/srv`) won't be visible inside
the box. Same advice on macOS/Windows: keep the repo in your home directory.

### Step 2 — Create the Distrobox (on the host)

Still in the host terminal, from the repo root:

```sh
distrobox-assemble create --file ./distrobox.ini
```

This builds a Fedora 41 toolbox containing Electron's runtime libraries (GTK,
X11, NSS, ALSA), Node.js 22, npm, and pnpm. The first run downloads the base
image (~400 MB) and installs packages — a couple of minutes. Subsequent
invocations are no-ops.

You'll see `Container felafel created` when it's done. Verify with:

```sh
distrobox list
```

You should see a row for `felafel`. Skip this step entirely if you're on
macOS/Windows or in Codespaces (see "Other host setups" below).

### Step 3 — Open VS Code and reopen in the Dev Container (on the host)

Launch VS Code on your host:

```sh
code .
```

VS Code should detect the [`.devcontainer/`](.devcontainer/) config and prompt
"Reopen in Container" in the bottom-right. Click it. If you miss the prompt, run
`Dev Containers: Reopen in Container` from the Command Palette (`Ctrl+Shift+P`).

The first build of the Dev Container takes a few minutes — it has to pull the
base image and install the configured features (Docker-in-Docker, Python, Claude
Code). Subsequent reopens are fast (cached).

When the container is up, the bottom-left status bar reads **Dev Container:
Felafel**.

### Step 4 — Install dependencies (in the Dev Container terminal)

Open a terminal inside VS Code (`` Ctrl+` ``). You're now inside the Dev
Container — the prompt reflects the container's filesystem.

```sh
pnpm install
```

This:

- Resolves the workspace dependency graph (`apps/desktop`, `apps/orchestrator`,
  `packages/shared`)
- Installs every package's deps into a shared `node_modules` at the repo root

You only need to run `pnpm install` once across both environments —
`node_modules` lives at `~/felafel/node_modules`, which both the Dev Container
and the Distrobox can see.

### Step 5 — Open a Distrobox shell (on the host)

In a **separate** host terminal (don't close the VS Code one — you'll keep using
it):

```sh
distrobox enter felafel
cd ~/felafel    # or wherever you cloned
```

Your prompt changes to reflect you're inside the box. On Bluefin DX it gets a 📦
prefix; otherwise `hostname` reads `felafel`.

### Step 6 — Run the app (in the Distrobox shell)

```sh
pnpm dev
```

Watch the logs. You should see, in order:

1. `dev server running for the electron renderer process at:
   http://localhost:5173/`
2. `orchestrator listening on http://127.0.0.1:909x`
3. `starting electron app...`
4. The Electron window opens on your host display, showing "To get started,
   edit src/renderer/src/App.tsx" with "Orchestrator: ready" and an empty
   workers list

Edit `apps/desktop/src/renderer/src/App.tsx` in VS Code and the renderer
hot-reloads in the Electron window. Edit `apps/desktop/src/main/index.ts` and
electron-vite restarts the main process. Stop everything with `Ctrl+C` in the
Distrobox shell.

## Daily commands

| Command | Where to run | What it does |
| --- | --- | --- |
| `pnpm dev` | **Distrobox shell** (needs display) | electron-vite dev mode; opens the Electron window on your host |
| `pnpm lint` | Dev Container or Distrobox | oxlint across every workspace package |
| `pnpm lint:md` | Dev Container or Distrobox | markdownlint over every `*.md` (excluding `node_modules`, build output, snapshots) |
| `pnpm lint:sh` | Dev Container or Distrobox | shellcheck over `setup.sh` + the husky hook scripts |
| `pnpm lint:exports` | Dev Container or Distrobox | Verify every `@felafel/<pkg>/<sub-path>` import has a matching entry in the target package's `package.json#exports` (catches the tsconfig-paths-vs-package-exports drift) |
| `pnpm lint:scripts` | Dev Container or Distrobox | oxlint over root-level `.mjs` files (`commitlint.config.mjs`, `scripts/*.mjs`) that fall outside the per-package lint scope |
| `pnpm lint:eslint` | Dev Container or Distrobox | eslint over the whole repo via the flat config at [`eslint.config.mjs`](eslint.config.mjs). Owns the 300-line file cap (`max-lines`) + the other 7 LOC/complexity caps after [PAI-141](https://linear.app/paint-creek-software/issue/PAI-141) PR 3 retired the custom `lint:loc` ratchet |
| `pnpm check-types` | Dev Container or Distrobox | `tsc --noEmit` across every workspace package |
| `pnpm test` | Dev Container or Distrobox | vitest unit suites across every workspace package |
| `pnpm db:check` | Dev Container or Distrobox | Drizzle schema-vs-migrations drift check; fails if the schema in `@felafel/contracts` got edited without `db:generate` |
| `pnpm knip` | Dev Container or Distrobox | Dead-code + unused-export detection across the repo |
| `pnpm build` | Dev Container or Distrobox | Bundle main + preload + renderer into `apps/desktop/out/` |
| `pnpm package` | Dev Container or Distrobox | Run electron-builder; produces installer in `apps/desktop/release/` |

Every `lint:*` / `check-types` / `test` / `db:check` / `knip` entry above
also runs automatically via the husky pre-commit hook
([`.husky/pre-commit`](.husky/pre-commit)) and the merge-gating lint
workflow ([`.github/workflows/lint.yml`](.github/workflows/lint.yml)).
The table doubles as a discoverability index for the pipeline.

`pnpm dev` is the only command that *requires* the Distrobox shell — everything
else works in either environment, but the Dev Container is the natural home for
editor-driven workflows (Claude Code, lint, typecheck) since that's where VS
Code's terminal lives.

In dev, orchestrator data (the SQLite database) lives at
`apps/desktop/.dev-orchestrator-data/`. In a packaged build it moves to
`<userData>/orchestrator/` under the OS-standard userData dir.

## Orchestrator: embedded vs container

By default, the desktop app spawns the orchestrator as a child process bound
to `127.0.0.1` — embedded mode, no external dependencies, fully offline.

The same orchestrator service is also packaged as a Docker image for homelab
or multi-host deployment:

```sh
pnpm --filter @felafel/orchestrator package      # builds felafel-orchestrator:latest
docker run --rm -p 9090:9090 -v orch-data:/data felafel-orchestrator
```

The image is `node:24-alpine` based, exposes 9090, and stores its SQLite DB
under the `/data` mount. Wiring the desktop client to point at a remote
orchestrator (instead of the spawned child) is a future enhancement.

## Tearing down and rebuilding

```sh
# host: rebuild the Distrobox from scratch
distrobox rm -f felafel
distrobox-assemble create --file ./distrobox.ini

# VS Code: rebuild the Dev Container
# Command Palette → "Dev Containers: Rebuild Container"
```

## Other host setups

- **Codespaces** — Dev Container is automatic; the Distrobox path doesn't apply
  (no host display). `pnpm dev` won't open a window. Useful for editing,
  lint/typecheck, build, and package.
- **macOS / Windows** — Dev Container works as above for non-GUI tasks. For
  `pnpm dev` you'd install Node 22 + pnpm directly on the host (Distrobox is
  Linux-only). Or use a Linux VM.

## IPC contract

Channel names and payload types live in
[`packages/shared/src/index.ts`](packages/shared/src/index.ts). Main exposes
them via `ipcMain.handle`, preload re-exposes a typed surface to the renderer
through `contextBridge`, and `window.api` is typed against `DesktopApi`.
