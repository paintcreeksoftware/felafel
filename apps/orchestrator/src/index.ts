import { serve } from "@hono/node-server";
import { createDb } from "@felafel/db";
import { createLogger } from "@felafel/logs";
import { buildApp } from "@felafel/orchestrator/app";
import { Defaults, EnvVars } from "@felafel/orchestrator/constants";
import { startSweep } from "@felafel/orchestrator/sweep";

const logger = createLogger({ service: "felafel-orchestrator" });

const port = Number(process.env[EnvVars.PORT] ?? Defaults.PORT);
const hostname = process.env[EnvVars.HOST] ?? Defaults.HOST;
const dataDir = process.env[EnvVars.DATA_DIR];

if (!dataDir) {
  logger.error({ envVar: EnvVars.DATA_DIR }, "startup.config.missing");
  process.exit(1);
}

const { db, close: closeDb } = createDb(dataDir);
const app = buildApp({ db });
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
  process.exit(0);
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
