// Electron main process entry point. The actual application lifecycle and
// state owner is `DesktopApp`, which lives in
// `apps/desktop/src/main/desktop.ts` (module-private there, exposed only
// through `startDesktopApp`). This file owns the OTel bootstrap + the
// process-signal/Electron-lifecycle shutdown wiring.
import { app } from "electron";

import { shutdownBackend } from "@felafel/backend";
import { bootstrap, Service } from "@felafel/logs";

import { startDesktopApp } from "@felafel/desktop/main/desktop";

const { logger, sdk } = bootstrap({ service: Service.DESKTOP_MAIN });

startDesktopApp({ logger, sdk });

let shuttingDown = false;
/**
 * Flush the OTel SDK exactly once on the first terminating signal —
 * subsequent duplicate signals are no-ops. Caller does not exit the
 * process; Electron handles its own teardown via `before-quit`.
 * @param signal - the trigger that fired this handler.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "shutdown.start");
  await shutdownBackend(sdk, logger);
}

app.on("before-quit", () => {
  void shutdown("before-quit");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
