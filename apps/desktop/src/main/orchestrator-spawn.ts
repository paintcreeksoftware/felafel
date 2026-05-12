// Spawn-invocation decider for the orchestrator child. Packaged builds
// run the bundled `.mjs` under Electron's own Node (via
// `ELECTRON_RUN_AS_NODE`), dev runs under system Node. Branch lives
// here so the lifecycle code in orchestrator.ts stays focused on
// process management.
import { app } from "electron";

/**
 * Tag emitted in `ELECTRON_RUN_AS_NODE` so a packaged build's spawned
 * child runs as Node rather than as a second Electron app instance.
 * Electron checks this env var on startup; presence flips the runtime
 * mode.
 */
const ELECTRON_RUN_AS_NODE = "ELECTRON_RUN_AS_NODE";

/** Spawn invocation parts: command, argv, and any extra env to layer on top of `process.env`. */
interface SpawnInvocation {
  command: string;
  args: string[];
  extraEnv: Record<string, string>;
}

/**
 * Decide how to invoke the orchestrator script.
 *
 * @remarks
 * In a packaged build: Electron's bundled Node via `process.execPath` +
 * `ELECTRON_RUN_AS_NODE` + `--experimental-sqlite`. In dev/tests:
 * system `node` (24+, where `node:sqlite` is stable without the flag).
 *
 * TODO: drop `--experimental-sqlite` once Electron's bundled Node tracks
 * a release where `node:sqlite` is GA. Today Electron 41 ships a Node
 * where it's still experimental; once the bundled Node matches Node 24
 * LTS's GA promotion the flag becomes a runtime warning and should be
 * removed.
 *
 * @param script - absolute path to the bundled `.mjs` entry
 * @returns command/argv/env triple to pass to {@link spawn}
 */
export function buildSpawnInvocation(script: string): SpawnInvocation {
  if (app.isPackaged) {
    return {
      command: process.execPath,
      args: ["--experimental-sqlite", script],
      extraEnv: { [ELECTRON_RUN_AS_NODE]: "1" },
    };
  }
  return { command: "node", args: [script], extraEnv: {} };
}
