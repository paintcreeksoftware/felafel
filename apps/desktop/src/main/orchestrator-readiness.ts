// Readiness probe for the orchestrator child. Polls `/health` with
// exponential backoff until it returns 200 or the retry budget is
// exhausted.
//
// Extracted out of orchestrator.ts so OrchestratorManager can stay
// focused on lifecycle and the retry-policy knobs live in one place.
import pRetry from "p-retry";

/** Initial readiness-poll delay, doubled per attempt up to {@link MAX_PROBE_DELAY_MS}. */
const INITIAL_PROBE_DELAY_MS = 50;
/** Cap for exponential backoff between readiness probes. */
const MAX_PROBE_DELAY_MS = 1_000;
/** Maximum readiness-probe attempts (with exponential backoff between, capped at MAX_PROBE_DELAY_MS). */
const MAX_PROBE_ATTEMPTS = 12;

/**
 * Poll `${url}/health` with exponential backoff until it returns 200 or
 * the retry budget is exhausted.
 *
 * @param url - base URL where the orchestrator is binding
 * @throws if the orchestrator doesn't reach ready within
 * {@link MAX_PROBE_ATTEMPTS} attempts
 */
export async function waitForOrchestratorReady(url: string): Promise<void> {
  await pRetry(
    async () => {
      const res = await fetch(`${url}/health`);
      if (!res.ok) {
        throw new Error(`/health returned ${res.status}`);
      }
    },
    {
      retries: MAX_PROBE_ATTEMPTS - 1,
      factor: 2,
      minTimeout: INITIAL_PROBE_DELAY_MS,
      maxTimeout: MAX_PROBE_DELAY_MS,
    },
  );
}
