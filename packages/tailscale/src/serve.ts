// `tailscale serve` flow: shared spawn wrapper for mutating commands
// (publish/unpublish) + read-only ServeConfig retrieval. Pulled out of
// manager.ts so the class stays under the 300-line source-file cap
// (PAI-140) and so the serve helpers can be tested without
// instantiating the manager.
import { execa } from "execa";
import {
  classifyServeError,
  type ServeFailureError,
} from "@felafel/tailscale/classify";
import { parseServeConfigJson } from "@felafel/tailscale/parse";

/** Outer ceiling on a `tailscale serve` mutation, regardless of inner timeout. */
const SERVE_OUTER_TIMEOUT_MS = 60_000;
/** 5-second cap on the read-only `serve status --json` invocation. */
const SERVE_READ_TIMEOUT_MS = 5_000;

/**
 * Shared spawn wrapper for `tailscale serve` mutating commands (publish,
 * unpublish). Handles abort-aware timeout + error classification. Throws
 * a `ServeFailureError` (Error decorated with a `classification` payload)
 * so callers can `await` and let exceptions propagate while still being
 * able to inspect the failure mode via `isServeFailureError`.
 * @param binary - resolved path to the `tailscale` binary
 * @param args - argv to pass after the binary
 * @throws ServeFailureError when the CLI returns a classified failure
 */
export async function runServeMutation(binary: string, args: string[]): Promise<void> {
  const result = await execa(binary, args, {
    cancelSignal: AbortSignal.timeout(SERVE_OUTER_TIMEOUT_MS),
    reject: false,
  });
  if (result.exitCode === 0 && !result.isCanceled) {
    return;
  }
  const combined = `${result.stdout}\n${result.stderr}`;
  const cls = classifyServeError(combined, result.exitCode ?? null, result.isCanceled);
  const error: ServeFailureError = Object.assign(
    new Error(`tailscale serve (${cls.kind}): ${cls.message}`),
    { classification: cls },
  );
  throw error;
}

/**
 * Read the current `tailscale serve` config and return what's mapped to
 * `tailnetPort`, or null if nothing is mapped. Used at startup to detect
 * a stale mapping left by a prior crashed launch.
 * @param binary - resolved path to the `tailscale` binary
 * @param tailnetPort - the Tailnet-side port to look up
 * @returns `{ targetLocalPort }` if a TCP forward exists, else null
 */
export async function readServePublished(
  binary: string,
  tailnetPort: number,
): Promise<{ targetLocalPort: number } | null> {
  const result = await execa(binary, ["serve", "status", "--json"], {
    cancelSignal: AbortSignal.timeout(SERVE_READ_TIMEOUT_MS),
    reject: false,
  });
  // Tailscale exits non-zero with no JSON when nothing is configured;
  // treat that as "nothing mapped" rather than a hard error.
  if (result.stdout.trim().length === 0) {
    return null;
  }
  return parseServeConfigJson(result.stdout, tailnetPort);
}
