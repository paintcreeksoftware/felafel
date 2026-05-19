import { serve } from "@hono/node-server";
import { shutdownBackend } from "@felafel/backend";
import { createDb } from "@felafel/db";
import { buildApp } from "@felafel/orchestrator/app";
import { Defaults, EnvVars } from "@felafel/orchestrator/constants";
import { startSweep } from "@felafel/orchestrator/sweep";

const port = Number(process.env[EnvVars.PORT] ?? Defaults.PORT);
const hostname = process.env[EnvVars.HOST] ?? Defaults.HOST;
const dataDir = process.env[EnvVars.DATA_DIR];

if (!dataDir) {
  // No logger yet — buildApp owns the bootstrap.
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
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutdown.start");
  stopSweep();
  closeDb();
  await shutdownBackend(sdk, logger);
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
