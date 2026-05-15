import { hostname as osHostname } from "node:os";
import type { Logger } from "@felafel/logs";
import {
  WorkerRegistrationSchema,
  archForRegistration,
  osForRegistration,
  type WorkerRegistration,
} from "@felafel/shared";

/**
 * Configuration accepted by {@link startHeartbeat}.
 */
interface StartHeartbeatOptions {
  /** Worker UUID, persisted to disk. */
  identity: string;
  /** URL the orchestrator should dial back on, e.g. `http://127.0.0.1:9091`. */
  controlPlaneUrl: string;
  /** Orchestrator base URL, e.g. `http://orchestrator:9090`. */
  orchestratorUrl: string;
  /** Tick, in milliseconds. Production default 30000. */
  intervalMs: number;
  /**
   * Service-bound logger (the parent worker logger). The heartbeat loop's
   * non-200 responses + transport errors land in the same unified stream
   * as the rest of the worker's output. Required — silent log loss is a
   * worse failure mode than a compile-time error.
   */
  logger: Logger;
}

/**
 * Start the worker's heartbeat loop. Posts a `WorkerRegistration` payload
 * to `${orchestratorUrl}/workers` immediately, then every `intervalMs`.
 * The same call serves both initial registration and subsequent heartbeats —
 * the orchestrator upserts by id.
 *
 * Errors are logged and swallowed: the loop continues so the worker
 * recovers automatically once the orchestrator becomes reachable again.
 * @param opts - heartbeat configuration; see {@link StartHeartbeatOptions}
 * @returns a stop function that halts the loop and prevents future ticks
 */
export function startHeartbeat(opts: StartHeartbeatOptions): () => void {
  let stopped = false;

  /**
   *
   */
  async function tick(): Promise<void> {
    if (stopped) {
      return;
    }
    const payload: WorkerRegistration = WorkerRegistrationSchema.parse({
      id: opts.identity,
      hostname: osHostname(),
      os: osForRegistration(),
      arch: archForRegistration(),
      controlPlaneUrl: opts.controlPlaneUrl,
    });
    const startMs = Date.now();
    try {
      const res = await fetch(`${opts.orchestratorUrl}/workers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const durationMs = Date.now() - startMs;
      if (res.ok) {
        opts.logger.debug({ durationMs }, "heartbeat.complete");
      } else {
        opts.logger.error(
          { status: res.status, statusText: res.statusText, durationMs },
          "heartbeat.failed",
        );
      }
    } catch (error) {
      const durationMs = Date.now() - startMs;
      opts.logger.error({ err: error, durationMs }, "heartbeat.transport-error");
    }
  }

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, opts.intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
