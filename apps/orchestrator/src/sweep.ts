import { type Db, markRunsTimedOutSince, markWorkersStaleSince } from "@felafel/db";

/** Default sweep tick — runs every 30s in production. */
export const DEFAULT_SWEEP_INTERVAL_MS = 30_000;
/** Default worker staleness threshold — 90s without a heartbeat. */
export const DEFAULT_WORKER_STALE_AFTER_MS = 90_000;
/** Default run dispatch timeout — 5min between dispatch and ack. */
export const DEFAULT_RUN_TIMEOUT_MS = 300_000;

/**
 * Configuration accepted by {@link startSweep}.
 */
export interface StartSweepOptions {
  db: Db;
  /** Tick, in milliseconds. */
  intervalMs?: number;
  /** Worker is considered stale if `last_seen_at` is older than this. */
  workerStaleAfterMs?: number;
  /** Dispatched run is considered timed-out after this long without an ack. */
  runTimeoutMs?: number;
}

/**
 * Start the orchestrator's periodic liveness/timeout sweep. Each tick:
 *
 * - flips workers without a recent heartbeat to `status='stale'`
 *   (they re-register → status flips back to 'active');
 * - flips runs that have been `dispatched` past `runTimeoutMs` to
 *   `status='failed'` with `error='dispatch timeout'`.
 *
 * Errors during a tick are logged and swallowed; the loop continues.
 *
 * @param opts - sweep configuration; see {@link StartSweepOptions}
 * @returns a stop function that halts the loop
 */
export function startSweep(opts: StartSweepOptions): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const workerStaleAfterMs =
    opts.workerStaleAfterMs ?? DEFAULT_WORKER_STALE_AFTER_MS;
  const runTimeoutMs = opts.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;

  let stopped = false;

  function tick(): void {
    if (stopped) {
      return;
    }
    const now = Date.now();
    const workerThreshold = new Date(now - workerStaleAfterMs).toISOString();
    const runThreshold = new Date(now - runTimeoutMs).toISOString();
    try {
      const workersMarked = markWorkersStaleSince(opts.db, workerThreshold);
      const runsMarked = markRunsTimedOutSince(
        opts.db,
        runThreshold,
        "dispatch timeout",
      );
      if (workersMarked > 0 || runsMarked > 0) {
        console.log(
          `sweep: marked ${workersMarked.toString()} workers stale, ${runsMarked.toString()} runs failed`,
        );
      }
    } catch (error) {
      console.error("sweep error:", error);
    }
  }

  tick();
  const timer = setInterval(tick, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
