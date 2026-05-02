import {
  JobAssignmentSchema,
  type Worker,
} from "@felafel/shared";

/** Default dispatch timeout, in milliseconds. */
const DISPATCH_TIMEOUT_MS = 5_000;

/**
 * POST a JobAssignment to the worker's `controlPlaneUrl + /jobs/run`. Used
 * by the runs route's POST /runs handler after inserting the run row.
 * Throws a plain `Error` with a human-readable message on non-2xx, network
 * failure, or timeout — the message is safe to surface as the Run's
 * `error` field.
 *
 * @param worker - the worker selected by the dispatch logic
 * @param runId - server-generated run id
 * @param payload - opaque job payload, forwarded as-is
 * @throws {Error} on non-2xx response, network failure, or timeout
 */
export async function dispatchToWorker(
  worker: Worker,
  runId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const body = JobAssignmentSchema.parse({ runId, payload });
  const url = `${worker.controlPlaneUrl}/jobs/run`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`dispatch to ${url} failed: ${message}`, { cause: error });
  });

  if (!res.ok) {
    throw new Error(
      `dispatch to ${url} returned ${res.status.toString()} ${res.statusText}`,
    );
  }
}
