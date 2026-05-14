import { serve } from "@hono/node-server";
import { createDb } from "@felafel/db";
import { buildApp } from "@felafel/orchestrator/app";
import { Defaults, EnvVars } from "@felafel/orchestrator/constants";
import { startSweep } from "@felafel/orchestrator/sweep";

const port = Number(process.env[EnvVars.PORT] ?? Defaults.PORT);
const hostname = process.env[EnvVars.HOST] ?? Defaults.HOST;
const dataDir = process.env[EnvVars.DATA_DIR];

if (!dataDir) {
  // Pre-buildApp: no logger yet (buildApp owns the OTel bootstrap).
  // Use stderr directly for this one-shot startup error so the
  // operator sees the misconfig at the same place the rest of the
  // log stream lands.
  process.stderr.write(`${EnvVars.DATA_DIR} is required\n`);
  process.exit(1);
}

const { db, close: closeDb } = createDb(dataDir);
const { app, sdk, logger } = buildApp({ db });
const stopSweep = startSweep({ db, logger });

serve({ fetch: app.fetch, port, hostname }, (info) => {
  logger.info(
    { address: info.address, port: info.port },
    "startup.listening",
  );
});

/**
 * Graceful-shutdown handler — log the trigger signal and exit cleanly
 * so the Electron parent's child-process supervisor sees the orderly
 * termination it expects.
 * @param signal - the POSIX signal name that triggered shutdown
 */
function shutdown(signal: string): void {
  logger.info({ signal }, "shutdown.start");
  stopSweep();
  closeDb();
  // sdk.shutdown is async; we don't await because process.exit is the
  // canonical termination and the OTel exporters' batch flush is
  // best-effort here. .catch keeps a stray rejection from being
  // unhandled if the process happens to outlive the call.
  sdk.shutdown().catch(() => {
    /* swallow — process is exiting anyway */
  });
  process.exit(0);
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
