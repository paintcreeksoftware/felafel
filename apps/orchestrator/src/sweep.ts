import { type Db, markRunsTimedOutSince, markWorkersStaleSince } from "@felafel/db";

/** Default sweep tick — runs every 30s in production. */
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;
/** Default worker staleness threshold — 90s without a heartbeat. */
const DEFAULT_WORKER_STALE_AFTER_MS = 90_000;
/** Default run dispatch timeout — 5min between dispatch and ack. */
const DEFAULT_RUN_TIMEOUT_MS = 300_000;

/**
 * Number of consecutive sweep failures tolerated at the normal cadence
 * before backoff kicks in. The first few failures could be a transient
 * DB blip; sustained failure means something is actually wrong and we
 * shouldn't keep hammering at the normal interval.
 */
export const BACKOFF_THRESHOLD_FAILURES = 3;
/** Cap on the inter-tick delay during backoff. 5min — same scale as the run-timeout sweep window. */
export const BACKOFF_MAX_DELAY_MS = 300_000;
/** Doubling per additional failure past {@link BACKOFF_THRESHOLD_FAILURES}. */
const BACKOFF_FACTOR = 2;

/**
 * Pure function. Compute how long to wait before the next sweep tick
 * given the current consecutive-failure count. Below the threshold the
 * loop runs at its normal cadence; past it the delay doubles per
 * additional failure, capped at {@link BACKOFF_MAX_DELAY_MS}.
 * @param opts
 * @param opts.baseMs - normal inter-tick delay
 * @param opts.consecutiveFailures - failure count since last success
 * @param opts.thresholdFailures - failures tolerated before backoff
 * @param opts.maxDelayMs - upper bound on the backed-off delay
 * @returns delay in milliseconds for the next scheduled tick
 */
export function sweepDelayFor(opts: {
  baseMs: number;
  consecutiveFailures: number;
  thresholdFailures: number;
  maxDelayMs: number;
}): number {
  if (opts.consecutiveFailures <= opts.thresholdFailures) {
    return opts.baseMs;
  }
  const exponent = opts.consecutiveFailures - opts.thresholdFailures;
  const backoff = opts.baseMs * BACKOFF_FACTOR ** exponent;
  return Math.min(backoff, opts.maxDelayMs);
}

/**
 * Configuration accepted by {@link startSweep}.
 */
interface StartSweepOptions {
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
 * @param opts - sweep configuration; see {@link StartSweepOptions}
 * @returns a stop function that halts the loop
 */
export function startSweep(opts: StartSweepOptions): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const workerStaleAfterMs =
    opts.workerStaleAfterMs ?? DEFAULT_WORKER_STALE_AFTER_MS;
  const runTimeoutMs = opts.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let consecutiveFailures = 0;

  /**
   *
   */
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
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      console.error(
        `sweep error (consecutive failures: ${consecutiveFailures.toString()}):`,
        error,
      );
    }
    scheduleNext();
  }

  /**
   *
   */
  function scheduleNext(): void {
    if (stopped) {
      return;
    }
    const delay = sweepDelayFor({
      baseMs: intervalMs,
      consecutiveFailures,
      thresholdFailures: BACKOFF_THRESHOLD_FAILURES,
      maxDelayMs: BACKOFF_MAX_DELAY_MS,
    });
    timer = setTimeout(tick, delay);
  }

  tick();

  return () => {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
    }
  };
}
