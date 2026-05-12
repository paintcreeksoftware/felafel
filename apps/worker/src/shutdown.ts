// Shutdown sequence extracted from the entrypoint so it's unit-testable
// without spawning the worker process — mirrors the pattern used by
// `@felafel/worker/hosts` for `resolveHosts`.
import { type Server } from "node:http";
import { promisify } from "node:util";

/**
 * Maximum time the worker spends draining open connections during graceful
 * shutdown before forcing exit. Keeps Ctrl+C responsive even when an
 * in-flight request would otherwise stall {@link Server.close}.
 */
const SHUTDOWN_TIMEOUT_MS = 5_000;

/** Sentinel returned by {@link raceTimeout} when the deadline fires first. */
const TIMEOUT = Symbol("shutdown-timeout");

/** Dependencies the shutdown handler needs to do its job. */
interface ShutdownDeps {
  /** The HTTP server returned by `@hono/node-server`'s `serve()`. */
  server: Server;
  /** Stops the heartbeat interval; returned by `startHeartbeat`. */
  stopHeartbeat: () => void;
}

/**
 * Race `promise` against a deadline. Resolves with the promise's value, or
 * with {@link TIMEOUT} if the deadline fires first. The timer is `.unref()`'d
 * so it never keeps the event loop alive on its own.
 * @param promise - the work to race
 * @param ms - deadline in milliseconds
 * @returns the promise's resolved value or {@link TIMEOUT}
 */
function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) => {
    const timer = setTimeout(() => {
      resolve(TIMEOUT);
    }, ms);
    timer.unref();
  });
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Build a shutdown function that closes the worker's HTTP server gracefully
 * but **without waiting on idle keep-alive connections**. Idle sockets are
 * kicked immediately via {@link Server.closeIdleConnections} so the
 * `server.close()` drain can complete. If a real in-flight request prevents
 * close from completing within {@link SHUTDOWN_TIMEOUT_MS}, all remaining
 * sockets are force-closed via {@link Server.closeAllConnections} and the
 * handler resolves with a non-zero exit code.
 *
 * The handler does **not** call `process.exit` — it returns the exit code
 * so the caller controls process lifetime. This keeps the function
 * unit-testable in-process.
 * @param deps - the server to close and the heartbeat stopper
 * @returns a function that takes the triggering signal name and resolves
 *   with the exit code (0 on clean close, 1 on close error or timeout)
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<number> {
  const { server, stopHeartbeat } = deps;
  return async (signal: string): Promise<number> => {
    console.log(`received ${signal}, shutting down...`);
    stopHeartbeat();
    // Boot idle keep-alives so close()'s drain doesn't wait on them. This
    // is the actual bug fix — without it, an idle orchestrator keep-alive
    // socket prevented close() from ever invoking its callback.
    server.closeIdleConnections();

    const closeAsync = promisify(server.close.bind(server)) as () => Promise<void>;

    try {
      const result = await raceTimeout(closeAsync(), SHUTDOWN_TIMEOUT_MS);
      if (result === TIMEOUT) {
        console.error(`shutdown timed out after ${SHUTDOWN_TIMEOUT_MS.toString()}ms, forcing exit`);
        server.closeAllConnections();
        return 1;
      }
      return 0;
    } catch (error) {
      console.error("server close error:", error);
      return 1;
    }
  };
}
