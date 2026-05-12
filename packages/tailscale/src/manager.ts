// Tailscale CLI wrapper. Tailscale is an *external* system service — not a
// sidecar Felafel owns — so this module is a thin layer that shells out to
// whatever `tailscale` binary the user has on their PATH and surfaces the
// result as a typed status. Linux only for this first cut.
//
// Two write paths through `runUp`:
//
//   1. Session resume (no key): runs `tailscale up --timeout=5s`. Succeeds
//      silently if tailscaled has cached credentials and can re-auth without
//      interaction. Fails fast with an auth URL if it can't, so the renderer
//      can promptly open the paste-in modal.
//
//   2. Keyed (paste-in): runs `tailscale up --authkey-stdin --timeout=30s`
//      with the key piped on stdin. Longer timeout because the daemon is
//      doing a real handshake with Tailscale's coordination server.
//
// Outer 60s AbortController wraps both so a wedged spawn can't hang IPC
// forever; the inner --timeout flags are the CLI's own bail-outs.
//
// Why `--authkey-stdin` over `--authkey=`: the latter leaks the key to other
// users on the box via /proc/<pid>/cmdline. We probe the installed CLI with
// `tailscale up --help` once and cache the result.
import { execa } from "execa";
import pRetry from "p-retry";
import which from "which";
import { type TailscaleConnectResult, type TailscaleStatus } from "@felafel/shared";
import {
  classifyServeError,
  classifyUpError,
  type ServeFailureError,
} from "@felafel/tailscale/classify";
import { LOCALHOST, TailscaleEnvVars } from "@felafel/tailscale/constants";
import { parseServeConfigJson, parseStatusJson } from "@felafel/tailscale/parse";

/** Initial backoff between `tailscale status` retries on transient errors. */
const PROBE_RETRY_INITIAL_DELAY_MS = 200;
/** Cap for exponential backoff between probe retries. */
const PROBE_RETRY_MAX_DELAY_MS = 1_500;
/** Maximum number of probe attempts before surfacing the last error. */
const PROBE_RETRY_MAX_ATTEMPTS = 4;

/** 5-second cap on a single status probe. */
const PROBE_SINGLE_ATTEMPT_TIMEOUT_MS = 5_000;

/** Outer ceiling on a `tailscale up` invocation, regardless of inner --timeout. */
const UP_OUTER_TIMEOUT_MS = 60_000;

/** Result of capturing a child-process invocation's output. */
interface CaptureResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Manager for Tailscale CLI interactions. Owns the cache of resolved binary
 * path + last status + in-flight de-dup promises. Instantiate once per
 * Electron main process; tests can construct fresh instances per case to
 * avoid cross-test cache leakage.
 */
export class TailscaleManager {
  private cachedBinary: string | null | undefined;
  private cachedStatus: TailscaleStatus = { kind: "unknown" };
  private probeInflight: Promise<TailscaleStatus> | null = null;
  private upInflight: Promise<TailscaleConnectResult> | null = null;
  private stdinSupportCache: boolean | undefined;

  /**
   * Resolve the `tailscale` binary on PATH. Falls back to the
   * `FELAFEL_TAILSCALE_FAKE` env var when set so E2E tests can inject a
   * fixture script at the boundary instead of mocking spawn.
   *
   * @param opts.refresh - bypass the cache and re-resolve
   * @returns absolute path to the binary, or null if not found
   */
  async findBinary(opts: { refresh?: boolean } = {}): Promise<string | null> {
    const fake = process.env[TailscaleEnvVars.FELAFEL_TAILSCALE_FAKE];
    if (fake) {
      return fake;
    }
    if (this.cachedBinary !== undefined && !opts.refresh) {
      return this.cachedBinary;
    }
    this.cachedBinary = await which("tailscale", { nothrow: true });
    return this.cachedBinary;
  }

  /**
   * Last known Tailscale state. Synchronously available — does not spawn
   * the CLI. Returns `{ kind: "unknown" }` until the first {@link probeStatus}.
   */
  getCachedStatus(): TailscaleStatus {
    return this.cachedStatus;
  }

  /**
   * Probe the daemon's state. Concurrency-guarded — concurrent calls share
   * the same in-flight promise. Retries up to 3× with 200/500/1500ms
   * backoff on transient errors (EAGAIN, AbortError, etc.); deterministic
   * errors (EACCES, missing-binary) return immediately without retry.
   *
   * @returns the latest status; also updates the cache returned by
   * {@link getCachedStatus}
   */
  probeStatus(): Promise<TailscaleStatus> {
    if (this.probeInflight) {
      return this.probeInflight;
    }
    this.probeInflight = this.runProbeAndClear();
    return this.probeInflight;
  }

  /** Run a probe, then clear the in-flight handle. Async-await form of `.finally`. */
  private async runProbeAndClear(): Promise<TailscaleStatus> {
    try {
      return await this.doProbe();
    } finally {
      this.probeInflight = null;
    }
  }

  /**
   * Run `tailscale up`. Without a key, attempts session resume (5s timeout).
   * With a key, pipes the key via stdin (30s timeout). Outer 60s
   * AbortController is a safety net.
   *
   * @param authkey - optional Tailscale pre-auth key
   * @returns connect result; `ok: false, kind: "needs-key"` carries an
   * auth URL the renderer can show to the user
   */
  runUp(authkey?: string): Promise<TailscaleConnectResult> {
    if (this.upInflight) {
      return Promise.resolve({
        ok: false,
        kind: "error",
        message: "Connect already in progress",
      });
    }
    this.upInflight = this.runUpAndClear(authkey);
    return this.upInflight;
  }

  /** Run `tailscale up`, then clear the in-flight handle. Async-await form of `.finally`. */
  private async runUpAndClear(authkey: string | undefined): Promise<TailscaleConnectResult> {
    try {
      return await this.doRunUp(authkey);
    } finally {
      this.upInflight = null;
    }
  }

  /**
   * Internal probe with retry/backoff. Updates {@link cachedStatus} as a
   * side effect.
   *
   * @returns the resolved status
   */
  private async doProbe(): Promise<TailscaleStatus> {
    const binary = await this.findBinary();
    if (!binary) {
      this.cachedStatus = { kind: "missing-binary", path: null };
      return this.cachedStatus;
    }
    // Retain the last probe result so an exhausted-retry path can surface
    // the actual transient TailscaleStatus instead of a generic Error.
    let lastResult: TailscaleStatus | undefined = undefined;
    try {
      this.cachedStatus = await pRetry(
        async () => {
          lastResult = await this.tryProbeOnce(binary);
          if (
            lastResult.kind === "error"
            && /EAGAIN|ETIMEDOUT|aborted/i.test(lastResult.message)
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
      if (lastResult) {
        this.cachedStatus = lastResult;
      }
    }
    return this.cachedStatus;
  }

  /**
   * Single probe attempt. Spawns the CLI with a 5s timeout and parses
   * stdout. Recognized error patterns (EACCES, no daemon) get specialized
   * status; everything else returns `kind: "error"` with the raw message.
   *
   * @param binary - resolved path to the `tailscale` binary
   * @returns one-shot status (no retry logic)
   */
  private async tryProbeOnce(binary: string): Promise<TailscaleStatus> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PROBE_SINGLE_ATTEMPT_TIMEOUT_MS);
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
        if (/(failed to connect.*tailscaled|tailscaled\.sock)/i.test(e.stderr)) {
          return { kind: "disconnected", reason: "no-daemon" };
        }
      }
      return { kind: "error", message: e.message ?? String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Internal `tailscale up` runner with full error classification.
   *
   * @param authkey - optional pre-auth key; piped via stdin when supported
   * @returns the connect outcome
   */
  private async doRunUp(authkey?: string): Promise<TailscaleConnectResult> {
    const binary = await this.findBinary();
    if (!binary) {
      return { ok: false, kind: "error", message: "Tailscale binary not found on PATH" };
    }
    const ac = new AbortController();
    const outerTimer = setTimeout(() => ac.abort(), UP_OUTER_TIMEOUT_MS);
    try {
      const invocation = await this.buildUpInvocation(binary, authkey);
      const attempt = await this.attemptUpSpawn(binary, invocation, ac.signal);
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
   * @returns argv + optional stdin payload to feed `spawnAndCapture`
   */
  private async buildUpInvocation(
    binary: string,
    authkey: string | undefined,
  ): Promise<{ args: string[]; stdin: string | undefined }> {
    if (!authkey) {
      return { args: ["up", "--timeout=5s"], stdin: undefined };
    }
    const useStdin = await this.supportsAuthkeyStdin(binary);
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
  private async attemptUpSpawn(
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
   * Cached after first probe.
   *
   * @param binary - resolved path to the `tailscale` binary
   * @returns true if the help text mentions the flag
   */
  private async supportsAuthkeyStdin(binary: string): Promise<boolean> {
    if (this.stdinSupportCache !== undefined) {
      return this.stdinSupportCache;
    }
    try {
      const { stdout, stderr } = await execa(binary, ["up", "--help"]);
      this.stdinSupportCache = /--authkey-stdin/.test(stdout) || /--authkey-stdin/.test(stderr);
    } catch {
      this.stdinSupportCache = false;
    }
    return this.stdinSupportCache;
  }

  /**
   * Resolve the cached `tailscale` binary path or throw if it isn't on
   * PATH. Centralizes the fail-fast precondition for every method that
   * needs to spawn the CLI — a single source of the error message, called
   * from the spawn sites instead of an `if (!binary)` branch in each.
   *
   * Callers that want to short-circuit before any work (e.g. the desktop
   * main process at startup) can call this once explicitly to verify
   * Tailscale availability before constructing dependent components.
   *
   * @returns absolute path to the `tailscale` binary
   * @throws when the binary cannot be resolved on PATH
   */
  async requireBinary(): Promise<string> {
    const binary = await this.findBinary();
    if (!binary) {
      throw new Error("Tailscale binary not found on PATH");
    }
    return binary;
  }

  /**
   * Map a stable Tailnet TCP port to a local loopback port via
   * `tailscale serve --bg --tcp=<tailnetPort> tcp://127.0.0.1:<localPort>`.
   * Idempotent — re-publishing the same mapping is a no-op for Tailscale,
   * and republishing with a different `localPort` overwrites the prior
   * target.
   *
   * Workers on the same Tailnet can then dial
   * `http://<this-node-magicdns-name>:<tailnetPort>`; Tailscale forwards
   * to the local target. Lets the orchestrator keep an ephemeral local
   * bind without sacrificing remote discoverability.
   *
   * `--bg` (background) publish so the mapping persists past the calling
   * process and `tailscale serve status` (without `--json`) shows it. The
   * trade-off is that a hard-killed AppImage leaves the mapping behind;
   * `setupTailnetServe`'s reap-on-startup catches that on next launch
   * by reading the existing mapping and unpublishing it before
   * re-publishing the new ephemeral port.
   *
   * @param opts.tailnetPort - stable Tailnet-side TCP port
   * @param opts.localPort - local loopback port the orchestrator picked
   * @throws when the underlying `tailscale serve` invocation fails for a
   *   non-recoverable reason (no daemon, permission denied, port in use)
   */
  async publishServe(opts: { tailnetPort: number; localPort: number }): Promise<void> {
    await this.runServeCommand([
      "serve",
      "--bg",
      `--tcp=${String(opts.tailnetPort)}`,
      `tcp://${LOCALHOST}:${String(opts.localPort)}`,
    ]);
  }

  /**
   * Tear down the Tailnet→local TCP forward for `tailnetPort`. Idempotent:
   * a no-op when nothing is published. Should be called on graceful
   * shutdown so the AppImage doesn't leave a stale mapping pointing at a
   * dead local port.
   *
   * @param opts.tailnetPort - the stable Tailnet port to clear
   */
  async unpublishServe(opts: { tailnetPort: number }): Promise<void> {
    await this.runServeCommand([
      "serve",
      `--tcp=${String(opts.tailnetPort)}`,
      "off",
    ]);
  }

  /**
   * Read the current `tailscale serve` config and return what's mapped to
   * `tailnetPort`, or null if nothing is mapped. Used at startup to detect
   * a stale mapping left by a prior crashed AppImage launch (so we can
   * unpublish + republish with the new ephemeral port instead of leaving
   * a dangling forward to a dead PID).
   *
   * Caller MUST have confirmed Tailscale is available (e.g. via
   * {@link probeStatus}) before calling — this method throws if the binary
   * is missing rather than silently returning null. Null is reserved for
   * the genuine "no mapping configured" case.
   *
   * @param opts.tailnetPort - the Tailnet port to look up
   * @returns `{ targetLocalPort }` when a TCP forward exists, else null
   * @throws when the `tailscale` binary is missing on PATH
   */
  async readServePublished(
    opts: { tailnetPort: number },
  ): Promise<{ targetLocalPort: number } | null> {
    const binary = await this.requireBinary();
    const result = await execa(binary, ["serve", "status", "--json"], {
      cancelSignal: AbortSignal.timeout(PROBE_SINGLE_ATTEMPT_TIMEOUT_MS),
      reject: false,
    });
    // Tailscale exits non-zero with no JSON when nothing is configured;
    // treat that as "nothing mapped" rather than a hard error.
    if (result.stdout.trim().length === 0) {
      return null;
    }
    return parseServeConfigJson(result.stdout, opts.tailnetPort);
  }

  /**
   * Shared spawn wrapper for `tailscale serve` mutating commands (publish,
   * unpublish). Handles binary discovery, abort-aware timeout, and error
   * classification. Throws a descriptive Error on failure so callers can
   * just `await` and let exceptions propagate.
   *
   * @param args - argv to pass after the resolved tailscale binary
   * @throws when the binary is missing or the CLI returns a classified failure
   */
  private async runServeCommand(args: string[]): Promise<void> {
    const binary = await this.requireBinary();
    const result = await execa(binary, args, {
      cancelSignal: AbortSignal.timeout(UP_OUTER_TIMEOUT_MS),
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
}

