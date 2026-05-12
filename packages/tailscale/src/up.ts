// `tailscale up` flow: the spawn + classify + return-typed-outcome helpers
// the manager delegates to. Pulled out of manager.ts so the class stays
// under the 300-line source-file cap (PAI-140) and so the up-side state
// machine can be tested without instantiating the manager.
//
// Two write paths threaded through `runUpFlow`:
//
//   1. Session resume (no key): runs `tailscale up --timeout=5s`. Succeeds
//      silently if tailscaled has cached credentials and can re-auth without
//      interaction. Fails fast with an auth URL if it can't.
//
//   2. Keyed (paste-in): runs `tailscale up --authkey-stdin --timeout=30s`
//      with the key piped on stdin. Longer timeout because the daemon is
//      doing a real handshake with Tailscale's coordination server.
//
// Why `--authkey-stdin` over `--authkey=`: the latter leaks the key to
// other users on the box via /proc/<pid>/cmdline. We probe the installed
// CLI with `tailscale up --help` once and cache the result on the
// per-manager `UpFlowCache`.
import { execa } from "execa";
import { type TailscaleConnectResult } from "@felafel/shared";
import { classifyUpError } from "@felafel/tailscale/classify";

/** Outer ceiling on a `tailscale up` invocation, regardless of inner --timeout. */
const UP_OUTER_TIMEOUT_MS = 60_000;

/** Result of capturing a child-process invocation's output. */
interface CaptureResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Per-manager memoization for the up flow. Owned by the manager so each
 * instance has its own cache (matters for tests that construct fresh
 * managers between cases); threaded into the module-level helpers
 * explicitly so the helpers stay testable without a manager instance.
 */
export interface UpFlowCache {
  /**
   * Cached result of probing `tailscale up --help` for `--authkey-stdin`
   * support. `undefined` means "not probed yet". Tailscale CLI builds
   * never lose flags they once supported, so we only probe once per
   * manager instance.
   */
  stdinSupportCache: boolean | undefined;
}

/** Construct a fresh `UpFlowCache` for a new manager instance. */
export function makeUpFlowCache(): UpFlowCache {
  return { stdinSupportCache: undefined };
}

/**
 * Run `tailscale up` end-to-end: build the invocation, spawn the CLI,
 * classify the outcome, return a typed result. Manager owns the
 * in-flight dedup + the binary-not-found short-circuit; this function
 * only runs when both preconditions are satisfied.
 *
 * @param binary - resolved path to the `tailscale` binary
 * @param authkey - optional pre-auth key; piped via stdin when supported
 * @param cache - manager-owned cache for the --authkey-stdin probe
 * @returns the connect outcome
 */
export async function runUpFlow(
  binary: string,
  authkey: string | undefined,
  cache: UpFlowCache,
): Promise<TailscaleConnectResult> {
  const ac = new AbortController();
  const outerTimer = setTimeout(() => {
    ac.abort();
  }, UP_OUTER_TIMEOUT_MS);
  try {
    const invocation = await buildUpInvocation(binary, authkey, cache);
    const attempt = await attemptUpSpawn(binary, invocation, ac.signal);
    if (!attempt.ok) {
      return attempt.error;
    }
    const { captured, timedOut } = attempt;
    if (captured.exitCode === 0 && !timedOut) {
      return { ok: true, kind: "connected" };
    }
    const combined = `${captured.stdout}\n${captured.stderr}`;
    const cls = classifyUpError(combined, captured.exitCode, timedOut);
    if (cls.kind === "eacces") {
      return {
        ok: false,
        kind: "error",
        message: cls.message,
        remediation: "sudo tailscale set --operator=$USER",
      };
    }
    if (cls.kind === "needs-login") {
      return {
        ok: false,
        kind: "needs-key",
        authUrl: cls.authUrl,
        message: cls.message,
      };
    }
    return { ok: false, kind: "error", message: cls.message };
  } finally {
    clearTimeout(outerTimer);
  }
}

/**
 * Decide which CLI args + optional stdin to use for `tailscale up`. Branches
 * on whether the caller supplied a pre-auth key and whether the installed
 * CLI accepts `--authkey-stdin` (preferred for security).
 *
 * @param binary - resolved path to the `tailscale` binary
 * @param authkey - optional pre-auth key
 * @param cache - manager-owned cache for the --authkey-stdin probe
 * @returns argv + optional stdin payload to feed `attemptUpSpawn`
 */
async function buildUpInvocation(
  binary: string,
  authkey: string | undefined,
  cache: UpFlowCache,
): Promise<{ args: string[]; stdin: string | undefined }> {
  if (!authkey) {
    return { args: ["up", "--timeout=5s"], stdin: undefined };
  }
  const useStdin = await supportsAuthkeyStdin(binary, cache);
  if (!useStdin) {
    console.warn(
      "[tailscale] --authkey-stdin not supported by installed CLI; falling back to --authkey= (leaks the key via /proc/<pid>/cmdline)",
    );
    return {
      args: ["up", "--timeout=30s", `--authkey=${authkey}`],
      stdin: undefined,
    };
  }
  return {
    args: ["up", "--timeout=30s", "--authkey-stdin"],
    stdin: authkey,
  };
}

/**
 * Run a single `tailscale up` spawn with abort-aware capture. The outer
 * AbortController fires `ac.abort()` on timeout; AbortError or `signal.aborted`
 * returns a `timedOut` outcome with empty capture so the caller's classifier
 * can distinguish timeout from CLI error. Other errors are wrapped into the
 * `ok: false` branch so the caller can fail with a typed message.
 *
 * @param binary - resolved tailscale binary path
 * @param invocation - argv and optional stdin from {@link buildUpInvocation}
 * @param signal - abort signal hooked up to the outer timeout
 * @returns discriminated success/failure
 */
async function attemptUpSpawn(
  binary: string,
  invocation: { args: string[]; stdin: string | undefined },
  signal: AbortSignal,
): Promise<
  | { ok: true; captured: CaptureResult; timedOut: boolean }
  | { ok: false; error: TailscaleConnectResult }
> {
  // `reject: false` lets us inspect `result.isCanceled` / `result.failed`
  // without try/catch — execa returns the result object on both success
  // and known failure modes. Real spawn errors (e.g. ENOENT) still throw
  // and are caught here.
  try {
    const result = await execa(binary, invocation.args, {
      input: invocation.stdin,
      cancelSignal: signal,
      reject: false,
    });
    if (result.isCanceled) {
      return {
        ok: true,
        captured: { stdout: "", stderr: "", exitCode: null },
        timedOut: true,
      };
    }
    return {
      ok: true,
      captured: {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.exitCode ?? null,
      },
      timedOut: false,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        ok: false,
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Detect whether the installed Tailscale CLI supports `--authkey-stdin`.
 * Cached on the per-manager `UpFlowCache` after first probe.
 *
 * @param binary - resolved path to the `tailscale` binary
 * @param cache - manager-owned cache for the probe result
 * @returns true if the help text mentions the flag
 */
async function supportsAuthkeyStdin(binary: string, cache: UpFlowCache): Promise<boolean> {
  if (cache.stdinSupportCache !== undefined) {
    return cache.stdinSupportCache;
  }
  try {
    const { stdout, stderr } = await execa(binary, ["up", "--help"]);
    cache.stdinSupportCache =
      /--authkey-stdin/.test(stdout) || /--authkey-stdin/.test(stderr);
  } catch {
    cache.stdinSupportCache = false;
  }
  return cache.stdinSupportCache;
}
