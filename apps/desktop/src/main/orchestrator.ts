// Orchestrator sidecar lifecycle. The orchestrator is a Hono service shipped
// as a Node bundle (apps/orchestrator); the desktop main process spawns it as
// a child and points the renderer at it over IPC. Same shape as
// pocketbase.ts; this lives alongside it temporarily until C6 deletes
// PocketBase.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import getPort, { portNumbers } from "get-port";

const moduleDir = dirname(fileURLToPath(import.meta.url));

let orchestratorProcess: ChildProcess | null = null;

// In dev: resolve to the orchestrator package's built dist/. In packaged: to
// process.resourcesPath/orchestrator/. Packaging support lands in a follow-up
// commit — for now this throws clearly if invoked from a packaged build.
function resolveScriptPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "orchestrator", "index.js");
  }
  // moduleDir is apps/desktop/out/main → up three to reach apps/, then into
  // orchestrator/dist/index.js.
  return join(moduleDir, "..", "..", "..", "orchestrator", "dist", "index.js");
}

function resolveDataDir(): string {
  if (app.isPackaged) {
    return join(app.getPath("userData"), "orchestrator");
  }
  return join(moduleDir, "..", "..", ".dev-orchestrator-data");
}

// Exponential backoff probe: 50ms, 100, 200, 400, 800, 1000, 1000... capped at
// 1s, total budget 10s. ~12 attempts vs 66 with constant 150ms.
async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  let delay = 50;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 1000);
  }
  throw new Error(`orchestrator did not become ready within ${timeoutMs}ms`);
}

export async function startOrchestrator(): Promise<string> {
  const script = resolveScriptPath();
  if (!existsSync(script)) {
    throw new Error(
      `orchestrator bundle missing at ${script}. Run \`pnpm --filter @felafel/orchestrator build\`.`,
    );
  }

  const dataDir = resolveDataDir();
  await mkdir(dataDir, { recursive: true });

  // Random port in 9090–9190. PocketBase uses 8090–8190 so the two sidecars
  // can't collide while they run side-by-side during the cutover.
  const port = await getPort({ port: portNumbers(9090, 9190) });
  const host = "127.0.0.1";
  const url = `http://${host}:${port}`;

  orchestratorProcess = spawn("node", [script], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      ORCHESTRATOR_PORT: String(port),
      ORCHESTRATOR_HOST: host,
      ORCHESTRATOR_DATA_DIR: dataDir,
    },
  });

  orchestratorProcess.on("exit", (code, signal) => {
    console.error(`[orchestrator] exited code=${code} signal=${signal}`);
    orchestratorProcess = null;
  });

  await waitForServer(url);
  return url;
}

export async function stopOrchestrator(): Promise<void> {
  const proc = orchestratorProcess;
  if (!proc) return;
  orchestratorProcess = null;
  proc.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 5_000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
