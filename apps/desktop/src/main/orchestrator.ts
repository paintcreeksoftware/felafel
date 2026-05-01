// Orchestrator sidecar lifecycle. The orchestrator is a Hono service shipped
// as a Node bundle (apps/orchestrator); the desktop main process spawns it as
// a child and points the renderer at it over IPC.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { app } from "electron";
import getPort from "get-port";
import { join } from "pathe";
import {
  ELECTRON_RUN_AS_NODE,
  LOCALHOST,
} from "@felafel/desktop/main/constants";
// Single source of truth for the desktop→orchestrator env-var contract lives
// next to the reader. Importing it here keeps the spawned-process names
// in sync without duplicating the literals.
import { EnvVars as OrchestratorEnvVars } from "@felafel/orchestrator/constants";

/** Initial readiness-poll delay, doubled per attempt up to {@link MAX_PROBE_DELAY_MS}. */
const INITIAL_PROBE_DELAY_MS = 50;
/** Cap for exponential backoff between readiness probes. */
const MAX_PROBE_DELAY_MS = 1_000;
/** Total wall-clock budget for the readiness probe to succeed. */
const READINESS_TIMEOUT_MS = 10_000;
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
    return url;
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
   * the total budget elapses.
   *
   * @param url - base URL where the orchestrator is binding
   * @throws if the orchestrator doesn't reach ready within
   * {@link READINESS_TIMEOUT_MS}
   */
  private async waitForServer(url: string): Promise<void> {
    const start = Date.now();
    let delay = INITIAL_PROBE_DELAY_MS;
    while (Date.now() - start < READINESS_TIMEOUT_MS) {
      try {
        const res = await fetch(`${url}/health`);
        if (res.ok) {
          return;
        }
      } catch {
        // not ready yet
      }
      const currentDelay = delay;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, currentDelay);
      });
      delay = Math.min(delay * 2, MAX_PROBE_DELAY_MS);
    }
    throw new Error(
      `orchestrator did not become ready within ${READINESS_TIMEOUT_MS}ms`,
    );
  }
}
