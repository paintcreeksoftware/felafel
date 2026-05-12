// `tailscale status --json` probe flow: retry-with-backoff + one-shot
// spawn + classify stderr into a typed status. Pulled out of manager.ts
// so the class stays under the 300-line source-file cap (PAI-140) and
// so the probe path can be tested without instantiating the manager.
import { execa } from "execa";
import pRetry from "p-retry";
import { type TailscaleStatus } from "@felafel/shared";
import { matchesNoDaemonStderr } from "@felafel/tailscale/classify";
import { parseStatusJson } from "@felafel/tailscale/parse";

/** Initial backoff between `tailscale status` retries on transient errors. */
const PROBE_RETRY_INITIAL_DELAY_MS = 200;
/** Cap for exponential backoff between probe retries. */
const PROBE_RETRY_MAX_DELAY_MS = 1_500;
/** Maximum number of probe attempts before surfacing the last error. */
const PROBE_RETRY_MAX_ATTEMPTS = 4;
/** 5-second cap on a single status probe. */
const PROBE_SINGLE_ATTEMPT_TIMEOUT_MS = 5_000;

/**
 * Probe the daemon's state with retry + backoff. Returns a discriminated
 * `TailscaleStatus`. Transient errors (EAGAIN, AbortError, ETIMEDOUT)
 * trigger up to 3 retries with 200/500/1500ms backoff; deterministic
 * errors (EACCES, missing-binary) return immediately without retry.
 *
 * Manager owns the in-flight dedup + the `cachedStatus` field; this
 * function just produces the next status.
 *
 * @param binary - resolved path to the `tailscale` binary, or `null` when
 * `which("tailscale")` returned null
 * @returns the resolved status; `kind: "missing-binary"` when binary is null
 */
export async function runProbe(binary: string | null): Promise<TailscaleStatus> {
  if (!binary) {
    return { kind: "missing-binary", path: null };
  }
  // Retain the last probe result so an exhausted-retry path can surface
  // the actual transient TailscaleStatus instead of a generic Error.
  let lastResult: TailscaleStatus | undefined = undefined;
  try {
    return await pRetry(
      async () => {
        lastResult = await tryProbeOnce(binary);
        if (
          lastResult.kind === "error" &&
          /EAGAIN|ETIMEDOUT|aborted/i.test(lastResult.message)
        ) {
          throw new Error(lastResult.message);
        }
        return lastResult;
      },
      {
        retries: PROBE_RETRY_MAX_ATTEMPTS - 1,
        factor: 2,
        minTimeout: PROBE_RETRY_INITIAL_DELAY_MS,
        maxTimeout: PROBE_RETRY_MAX_DELAY_MS,
      },
    );
  } catch {
    // pRetry exhausted attempts — return the last observed status if any,
    // otherwise a generic error.
    return lastResult ?? { kind: "error", message: "Probe exhausted retries" };
  }
}

/**
 * Single probe attempt. Spawns the CLI with a 5s timeout and parses
 * stdout. Recognized error patterns (EACCES, no daemon) get specialized
 * status; everything else returns `kind: "error"` with the raw message.
 *
 * @param binary - resolved path to the `tailscale` binary
 * @returns one-shot status (no retry logic)
 */
async function tryProbeOnce(binary: string): Promise<TailscaleStatus> {
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
  }, PROBE_SINGLE_ATTEMPT_TIMEOUT_MS);
  try {
    const result = await execa(binary, ["status", "--json"], {
      cancelSignal: ac.signal,
    });
    return parseStatusJson(result.stdout);
  } catch (error: unknown) {
    // tailscale status exits non-zero when not logged in but still emits
    // valid JSON on stdout — try parsing before giving up. execa attaches
    // stdout/stderr/code to the thrown ExecaError.
    const e = error as { stdout?: unknown; stderr?: unknown; message?: string; code?: string };
    if (typeof e.stdout === "string" && e.stdout.length > 0) {
      const parsed = parseStatusJson(e.stdout);
      if (parsed.kind !== "error") {
        return parsed;
      }
    }
    if (typeof e.stderr === "string") {
      if (/permission denied|\bEACCES\b/i.test(e.stderr)) {
        return {
          kind: "error",
          message: "Tailscale daemon socket permission denied",
          remediation: "sudo tailscale set --operator=$USER",
        };
      }
      if (matchesNoDaemonStderr(e.stderr)) {
        return { kind: "disconnected", reason: "no-daemon" };
      }
    }
    return { kind: "error", message: e.message ?? String(error) };
  } finally {
    clearTimeout(timer);
  }
}
