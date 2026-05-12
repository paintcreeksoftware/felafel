// Tailscale CLI wrapper. Tailscale is an *external* system service — not a
// sidecar Felafel owns — so this module is a thin layer that shells out to
// whatever `tailscale` binary the user has on their PATH and surfaces the
// result as a typed status. Linux only for this first cut. The actual
// CLI-spawn flows live in adjacent modules:
//
//   - `tailscale status --json` retry + parse → `probe.ts`.
//   - `tailscale up` auth flow → `up.ts`.
//   - `tailscale serve` publish/unpublish/read → `serve.ts`.
//
// Manager owns the cached binary path, the last-known status, the
// in-flight de-dup promises, and the per-flow caches; the modules above
// own the IO.
import which from "which";
import { type TailscaleConnectResult, type TailscaleStatus } from "@felafel/shared";
import { LOCALHOST, TailscaleEnvVars } from "@felafel/tailscale/constants";
import { runProbe } from "@felafel/tailscale/probe";
import { readServePublished, runServeMutation } from "@felafel/tailscale/serve";
import { makeUpFlowCache, runUpFlow, type UpFlowCache } from "@felafel/tailscale/up";

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
  private readonly upFlowCache: UpFlowCache = makeUpFlowCache();

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

  /**
   * Run a probe, then clear the in-flight handle. Async-await form of
   * `.finally`. The retry/backoff + spawn-and-classify flow lives in
   * `probe.ts` — this method handles binary resolution + caches the
   * resolved status on the class so future {@link getCachedStatus}
   * callers see fresh state.
   */
  private async runProbeAndClear(): Promise<TailscaleStatus> {
    try {
      const binary = await this.findBinary();
      this.cachedStatus = await runProbe(binary);
      return this.cachedStatus;
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

  /**
   * Run `tailscale up`, then clear the in-flight handle. Async-await form of
   * `.finally`. The actual spawn + classify flow lives in `up.ts` — this
   * method just resolves the binary, short-circuits when missing, and
   * delegates.
   */
  private async runUpAndClear(authkey: string | undefined): Promise<TailscaleConnectResult> {
    try {
      const binary = await this.findBinary();
      if (!binary) {
        return { ok: false, kind: "error", message: "Tailscale binary not found on PATH" };
      }
      return await runUpFlow(binary, authkey, this.upFlowCache);
    } finally {
      this.upInflight = null;
    }
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
    const binary = await this.requireBinary();
    await runServeMutation(binary, [
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
    const binary = await this.requireBinary();
    await runServeMutation(binary, [
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
    return readServePublished(binary, opts.tailnetPort);
  }
}

