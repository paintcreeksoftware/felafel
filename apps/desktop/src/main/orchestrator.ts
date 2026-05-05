// Orchestrator sidecar lifecycle. The orchestrator is a Hono service shipped
// as a Node bundle (apps/orchestrator); the desktop main process spawns it as
// a child and points the renderer at it over IPC.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { app } from "electron";
import getPort from "get-port";
import pRetry from "p-retry";
import { join } from "pathe";
import { DesktopEnvVars, LOCALHOST } from "@felafel/desktop/main/constants";
// Single source of truth for the desktop→orchestrator env-var contract lives
// next to the reader. Importing it here keeps the spawned-process names
// in sync without duplicating the literals.
import { EnvVars as OrchestratorEnvVars } from "@felafel/orchestrator/constants";
import { type TailscaleManager } from "@felafel/desktop/main/tailscale";

/**
 * Tag emitted in `ELECTRON_RUN_AS_NODE` so a packaged build's spawned child
 * runs as Node rather than as a second Electron app instance. Electron
 * checks this env var on startup; presence flips the runtime mode. Used
 * only here, hence file-private.
 */
const ELECTRON_RUN_AS_NODE = "ELECTRON_RUN_AS_NODE";

/**
 * Default stable Tailnet TCP port the AppImage publishes via `tailscale serve`
 * when no env override is set. 9090 chosen to match the orchestrator's local
 * default — a remote worker pointing at `<desktop-tailnet-name>:9090` lands
 * on the same port number it would in dev. Kept inline here (not in a
 * `DesktopDefaults` object) until a second desktop-wide default justifies one.
 */
const DEFAULT_TAILNET_PORT = 9090;

/** Initial readiness-poll delay, doubled per attempt up to {@link MAX_PROBE_DELAY_MS}. */
const INITIAL_PROBE_DELAY_MS = 50;
/** Cap for exponential backoff between readiness probes. */
const MAX_PROBE_DELAY_MS = 1_000;
/** Maximum readiness-probe attempts (with exponential backoff between, capped at MAX_PROBE_DELAY_MS). */
const MAX_PROBE_ATTEMPTS = 12;
/** Grace period after SIGTERM before escalating to SIGKILL. */
const SIGTERM_GRACE_MS = 5_000;

const moduleDir = import.meta.dirname;

/** Spawn invocation parts: command, argv, and any extra env to layer on top of `process.env`. */
interface SpawnInvocation {
  command: string;
  args: string[];
  extraEnv: Record<string, string>;
}

/**
 * Manager for the orchestrator child process. Owns the spawned `ChildProcess`
 * handle and the lifecycle around it. One instance per Electron main
 * process; tests construct fresh instances per case.
 */
export class OrchestratorManager {
  private process: ChildProcess | null = null;
  private readonly tailscale: TailscaleManager;

  /**
   * Construct an OrchestratorManager.
   *
   * @param tailscale - the desktop's TailscaleManager instance. Used in
   * `start()`/`stop()` to publish/unpublish the orchestrator's stable
   * Tailnet port via `tailscale serve` when Tailscale is connected. The
   * dependency is required (not optional) so the wiring is visible at
   * the construction site instead of being silently disabled when missing.
   */
  constructor(tailscale: TailscaleManager) {
    this.tailscale = tailscale;
  }

  /**
   * Spawn the orchestrator as a child process, wait for `/health` to
   * respond, and return the URL the renderer/main can use to reach it.
   *
   * @returns absolute URL of the running orchestrator (e.g.
   * `http://127.0.0.1:9123`)
   * @throws if the bundle is missing on disk or the readiness probe doesn't
   * succeed within {@link READINESS_TIMEOUT_MS}
   */
  async start(): Promise<string> {
    const script = this.resolveScriptPath();
    if (!existsSync(script)) {
      throw new Error(
        `orchestrator bundle missing at ${script}. Run \`pnpm --filter @felafel/orchestrator build\`.`,
      );
    }

    const dataDir = this.resolveDataDir();
    await mkdir(dataDir, { recursive: true });

    // Kernel-assigned ephemeral port (bind to 0). Avoids picking a fixed
    // range that might collide with common services (Prometheus on 9090,
    // Cockpit on the Bluefin host, etc.) — the OS hands us something in the
    // dynamic range that's guaranteed free, and the renderer learns the
    // chosen port via IPC anyway.
    const port = await getPort();
    const url = `http://${LOCALHOST}:${port}`;

    const { command, args, extraEnv } = this.buildSpawnInvocation(script);
    this.process = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        ...extraEnv,
        [OrchestratorEnvVars.PORT]: String(port),
        [OrchestratorEnvVars.HOST]: LOCALHOST,
        [OrchestratorEnvVars.DATA_DIR]: dataDir,
      },
    });

    this.process.on("exit", (code, signal) => {
      console.error(`[orchestrator] exited code=${code} signal=${signal}`);
      this.process = null;
    });

    await this.waitForServer(url);
    await this.setupTailnetServe(port);
    return url;
  }

  /**
   * Publish the orchestrator's local port to a stable Tailnet TCP port via
   * `tailscale serve`, if Tailscale is connected. Reaps any stale mapping
   * left by a prior crashed launch first so a republish doesn't silently
   * fail with "already in use" pointing at a dead PID.
   *
   * No-op when Tailscale isn't connected (missing-binary, needs-login,
   * etc.) — orchestrator stays loopback-only and remote workers can't
   * reach it, but local renderers still work.
   *
   * Failures are logged and swallowed: the orchestrator child is already
   * running and serves loopback fine; a `tailscale serve` failure
   * shouldn't take down the whole desktop. The trade-off is "loopback
   * works, remote dispatch silently doesn't" — surfacing degraded state
   * to the renderer/health endpoint is tracked separately by PAI-102.
   *
   * @param localPort - the kernel-assigned ephemeral port the orchestrator bound
   */
  private async setupTailnetServe(localPort: number): Promise<void> {
    const status = await this.tailscale.probeStatus();
    if (status.kind !== "connected") {
      return;
    }
    const tailnetPort = this.resolveTailnetPort();
    try {
      const existing = await this.tailscale.readServePublished({ tailnetPort });
      if (existing && existing.targetLocalPort !== localPort) {
        await this.tailscale.unpublishServe({ tailnetPort });
      }
      await this.tailscale.publishServe({ tailnetPort, localPort });
    } catch (error) {
      console.error(
        `[orchestrator] tailscale serve setup failed (loopback still works, remote dispatch will not):`,
        error,
      );
    }
  }

  /**
   * Resolve the stable Tailnet port to publish on. Reads the env var if
   * set, otherwise falls back to {@link DEFAULT_TAILNET_PORT}.
   *
   * @returns the resolved port number
   */
  private resolveTailnetPort(): number {
    const raw = process.env[DesktopEnvVars.FELAFEL_ORCHESTRATOR_TAILNET_PORT];
    return raw ? Number(raw) : DEFAULT_TAILNET_PORT;
  }

  /**
   * Stop the orchestrator child gracefully. SIGTERM first, then SIGKILL
   * after {@link SIGTERM_GRACE_MS} if it hasn't exited. Idempotent — calling
   * when nothing is running is a no-op.
   */
  async stop(): Promise<void> {
    const proc = this.process;
    if (!proc) {
      return;
    }
    this.process = null;
    // Tear down the tailnet serve mapping BEFORE killing the child so a
    // dropped mapping doesn't briefly point at a still-listening loopback
    // port that the renderer is also closing. Wrapped in try/catch so an
    // unpublish failure can't block the SIGTERM that follows.
    try {
      await this.tailscale.unpublishServe({ tailnetPort: this.resolveTailnetPort() });
    } catch (error) {
      console.error("[orchestrator] tailscale unpublish on stop failed:", error);
    }
    proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, SIGTERM_GRACE_MS);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Resolve the orchestrator's bundled entrypoint. In dev: the workspace
   * package's `dist/index.mjs`. In packaged: the file electron-builder
   * placed at `process.resourcesPath/orchestrator/index.mjs`.
   *
   * @returns absolute path to the `.mjs` entrypoint
   */
  private resolveScriptPath(): string {
    const fake = process.env[DesktopEnvVars.FELAFEL_ORCHESTRATOR_FAKE_BUNDLE];
    if (fake) {
      return fake;
    }
    if (app.isPackaged) {
      return join(process.resourcesPath, "orchestrator", "index.mjs");
    }
    // moduleDir is apps/desktop/out/main → up three to reach apps/, then into
    // orchestrator/dist/index.mjs.
    return join(moduleDir, "..", "..", "..", "orchestrator", "dist", "index.mjs");
  }

  /**
   * Resolve the orchestrator's data directory. In packaged builds: under
   * Electron's `userData`. In dev: a gitignored repo-local folder.
   *
   * @returns absolute path; created lazily by {@link start}
   */
  private resolveDataDir(): string {
    if (app.isPackaged) {
      return join(app.getPath("userData"), "orchestrator");
    }
    return join(moduleDir, "..", "..", ".dev-orchestrator-data");
  }

  /**
   * Decide how to invoke the orchestrator script. In a packaged build:
   * Electron's bundled Node via `process.execPath` + `ELECTRON_RUN_AS_NODE`
   * + `--experimental-sqlite`. In dev/tests: system `node` (24+, where
   * `node:sqlite` is stable without the flag).
   *
   * TODO: drop `--experimental-sqlite` once Electron's bundled Node tracks
   * a release where `node:sqlite` is GA (no flag required). Today Electron
   * 41 ships a Node where it's still experimental; once the bundled Node
   * matches Node 24 LTS's GA promotion, the flag becomes a runtime warning
   * and should be removed.
   *
   * @param script - absolute path to the bundled `.mjs` entry
   * @returns command/argv/env triple to pass to {@link spawn}
   */
  private buildSpawnInvocation(script: string): SpawnInvocation {
    if (app.isPackaged) {
      return {
        command: process.execPath,
        args: ["--experimental-sqlite", script],
        extraEnv: { [ELECTRON_RUN_AS_NODE]: "1" },
      };
    }
    return { command: "node", args: [script], extraEnv: {} };
  }

  /**
   * Poll `${url}/health` with exponential backoff until it returns 200 or
   * the retry budget is exhausted.
   *
   * @param url - base URL where the orchestrator is binding
   * @throws if the orchestrator doesn't reach ready within
   * {@link MAX_PROBE_ATTEMPTS} attempts
   */
  private async waitForServer(url: string): Promise<void> {
    await pRetry(
      async () => {
        const res = await fetch(`${url}/health`);
        if (!res.ok) {
          throw new Error(`/health returned ${res.status}`);
        }
      },
      {
        retries: MAX_PROBE_ATTEMPTS - 1,
        factor: 2,
        minTimeout: INITIAL_PROBE_DELAY_MS,
        maxTimeout: MAX_PROBE_DELAY_MS,
      },
    );
  }
}
