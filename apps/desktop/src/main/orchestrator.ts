// Orchestrator sidecar lifecycle. The orchestrator is a Hono service shipped
// as a Node bundle (apps/orchestrator); the desktop main process spawns it as
// a child and points the renderer at it over IPC.
import { app } from "electron";
import { execa, type ResultPromise } from "execa";
import getPort from "get-port";
import type { Logger } from "@felafel/logs";
import { DesktopEnvVars, LOCALHOST } from "@felafel/desktop/main/constants";
import { ensureDataDir } from "@felafel/desktop/main/orchestrator-data-dir";
import { teeStderrToRotatedFile } from "@felafel/desktop/main/orchestrator-log-rotation";
import { resolveScriptPath } from "@felafel/desktop/main/orchestrator-paths";
import { waitForOrchestratorReady } from "@felafel/desktop/main/orchestrator-readiness";
import { buildSpawnInvocation } from "@felafel/desktop/main/orchestrator-spawn";
// Single source of truth for the desktop→orchestrator env-var contract lives
// next to the reader. Importing it here keeps the spawned-process names
// in sync without duplicating the literals.
import { EnvVars as OrchestratorEnvVars } from "@felafel/orchestrator/constants";
import { isServeFailureError, type TailscaleManager } from "@felafel/tailscale";

/**
 * Local mirror of `OrchestratorDegradations["tailnetServe"]` from
 * `@felafel/shared`. Imported as a type-only structural duplicate so this
 * file stays under the per-file dependency cap (~10). The shapes must
 * stay in sync; tests in shared check the full union remains compatible.
 */
interface TailnetServeDegradation {
  reason: string;
  remediation?: string;
}

/**
 * Default stable Tailnet TCP port the AppImage publishes via `tailscale serve`
 * when no env override is set. 9090 chosen to match the orchestrator's local
 * default — a remote worker pointing at `<desktop-tailnet-name>:9090` lands
 * on the same port number it would in dev. Kept inline here (not in a
 * `DesktopDefaults` object) until a second desktop-wide default justifies one.
 */
const DEFAULT_TAILNET_PORT = 9090;

/** Grace period after SIGTERM before execa escalates to SIGKILL. */
const SIGTERM_GRACE_MS = 5_000;

/**
 * Manager for the orchestrator child process. Owns the execa-spawned
 * subprocess handle and the lifecycle around it. One instance per Electron
 * main process; tests construct fresh instances per case.
 */
export class OrchestratorManager {
  private process: ResultPromise | null = null;
  private readonly tailscale: TailscaleManager;
  private readonly logger: Logger;
  // Tailnet port we published a `tailscale serve` mapping for during the
  // last successful start(). Null when start() ran on a Tailscale-less
  // host or the publish itself failed — stop() uses this to skip the
  // unpublish call so it doesn't throw "binary not found" on a host
  // that never had Tailscale to begin with.
  private publishedTailnetPort: number | null = null;
  // Kernel-assigned local port the orchestrator child is currently bound
  // to. Set in start() after waitForServer; cleared in stop(). Read by
  // refreshTailnetServe() so a renderer-driven refresh can re-attempt
  // the serve publish against the same target port without restarting
  // the orchestrator. Null outside the running window so refresh
  // becomes a no-op before start() and after stop().
  private currentLocalPort: number | null = null;
  // Set by setupTailnetServe when a publish attempt fails (most common:
  // EACCES because the user hasn't run `sudo tailscale set --operator=$USER`).
  // Read by desktop main after start() to attach to the OrchestratorStatus
  // ready broadcast so the renderer can display a degraded indicator.
  // Reset to null on every start() invocation so a fix-then-restart cycle
  // doesn't carry over a stale degradation.
  private tailnetServeDegradation: TailnetServeDegradation | null = null;

  /**
   * Construct an OrchestratorManager.
   * @param tailscale - the desktop's TailscaleManager instance. Used in
   * `start()`/`stop()` to publish/unpublish the orchestrator's stable
   * Tailnet port via `tailscale serve` when Tailscale is connected. The
   * dependency is required (not optional) so the wiring is visible at
   * the construction site instead of being silently disabled when missing.
   * @param logger - service-bound logger, typically the desktop main
   * logger's `child({ component: "orchestrator" })`. Required so sidecar
   * lifecycle events land in the unified log stream alongside the rest
   * of the desktop main process's output.
   */
  constructor(tailscale: TailscaleManager, logger: Logger) {
    this.tailscale = tailscale;
    this.logger = logger;
  }

  /**
   * Spawn the orchestrator as a child process, wait for `/health` to
   * respond, and return the URL the renderer/main can use to reach it.
   * @returns absolute URL of the running orchestrator (e.g.
   * `http://127.0.0.1:9123`)
   * @throws if the bundle is missing on disk or the readiness probe doesn't
   * succeed within {@link READINESS_TIMEOUT_MS}
   */
  async start(): Promise<string> {
    const script = resolveScriptPath();
    const dataDir = await ensureDataDir();

    // Kernel-assigned ephemeral port (bind to 0). Avoids picking a fixed
    // range that might collide with common services (Prometheus on 9090,
    // Cockpit on the Bluefin host, etc.) — the OS hands us something in the
    // dynamic range that's guaranteed free, and the renderer learns the
    // chosen port via IPC anyway.
    const port = await getPort();
    const url = `http://${LOCALHOST}:${port}`;

    const { command, args, extraEnv } = buildSpawnInvocation(script);
    // In a packaged build there's no terminal attached, so inheriting
    // stderr loses the orchestrator's JSONL log stream. Pipe it instead
    // and tee to a rotated file under `<userData>/logs/`. In dev mode
    // (`!app.isPackaged`), keep inheriting so the stream still hits
    // the developer's terminal.
    const packaged = app.isPackaged;
    this.process = execa(command, args, {
      stdio: ["ignore", "inherit", packaged ? "pipe" : "inherit"],
      env: {
        ...process.env,
        ...extraEnv,
        [OrchestratorEnvVars.PORT]: String(port),
        [OrchestratorEnvVars.HOST]: LOCALHOST,
        [OrchestratorEnvVars.DATA_DIR]: dataDir,
      },
      // execa handles the SIGTERM → SIGKILL escalation: when stop()
      // calls `.kill("SIGTERM")`, execa waits this long and sends
      // SIGKILL if the child hasn't exited. Retires the manual
      // setTimeout(SIGKILL) dance the previous spawn-based version
      // had.
      forceKillAfterDelay: SIGTERM_GRACE_MS,
      // execa rejects on non-zero exit by default; for a long-lived
      // supervised child we want the promise to resolve so the
      // try/await wrap below doesn't have to swallow a normal exit.
      reject: false,
    });

    if (packaged && this.process.stderr) {
      await teeStderrToRotatedFile(this.process.stderr, this.logger);
    }

    this.process.on("exit", (code, signal) => {
      this.logger.error({ code, signal }, "orchestrator.child.exited");
      this.process = null;
    });

    await waitForOrchestratorReady(url);
    // Remember the bound port so a later renderer-driven refresh can
    // re-attempt the serve publish against the same target without
    // restarting the orchestrator.
    this.currentLocalPort = port;
    await this.setupTailnetServe(port);
    return url;
  }

  /**
   * Re-run the tailnet-serve setup against the currently running
   * orchestrator. Used by the renderer's Tailscale refresh button so a
   * change to the host's `--operator` setting becomes visible without
   * an orchestrator restart: `tailscale status --json` is operator-blind,
   * but `tailscale serve` (which `setupTailnetServe` invokes) is exactly
   * what the operator setting gates, so a fresh attempt is the right
   * signal.
   *
   * No-op (returns the existing degradation unchanged) when called
   * before `start()` has bound a port or after `stop()` has cleared it.
   * @returns the (possibly updated) tailnet-serve degradation — null
   * when the fresh attempt succeeded, populated when it failed
   */
  async refreshTailnetServe(): Promise<TailnetServeDegradation | null> {
    const localPort = this.currentLocalPort;
    if (localPort === null) {
      return this.tailnetServeDegradation;
    }
    await this.setupTailnetServe(localPort);
    return this.tailnetServeDegradation;
  }

  /**
   * Publish the orchestrator's local port to a stable Tailnet TCP port via
   * `tailscale serve`, if Tailscale is connected. Reaps any stale mapping
   * left by a prior crashed launch first so a republish doesn't silently
   * fail with "already in use" pointing at a dead PID.
   *
   * No-op when Tailscale isn't connected (missing-binary, needs-login,
   * etc.) — orchestrator stays loopback-only and remote workers can't
   * reach it, but local renderers still work.
   *
   * Failures are logged AND captured as a degradation
   * (`tailnetServeDegradation` field, read via {@link getServeDegradation})
   * so the desktop main process can surface them in the renderer. The
   * orchestrator child is already running and serves loopback fine; a
   * `tailscale serve` failure shouldn't take down the whole desktop.
   * @param localPort - the kernel-assigned ephemeral port the orchestrator bound
   */
  private async setupTailnetServe(localPort: number): Promise<void> {
    // Reset the degradation up front so a previously-failed-then-fixed
    // start cycle reports clean state on the new run.
    this.tailnetServeDegradation = null;
    const status = await this.tailscale.probeStatus();
    if (status.kind !== "connected") {
      return;
    }
    const tailnetPort = this.resolveTailnetPort();
    try {
      const existing = await this.tailscale.readServePublished({ tailnetPort });
      if (existing && existing.targetLocalPort !== localPort) {
        await this.tailscale.unpublishServe({ tailnetPort });
      }
      await this.tailscale.publishServe({ tailnetPort, localPort });
      // Record the port we successfully published so stop() knows to
      // unpublish it. Set only AFTER publish succeeds — if publish
      // throws, the catch logs but the field stays null so stop()
      // doesn't try to unpublish something that was never published.
      this.publishedTailnetPort = tailnetPort;
    } catch (error) {
      this.logger.error(
        { err: error },
        "orchestrator.tailscale-serve.failed",
      );
      // Capture structured degradation for the renderer if the thrown
      // error carries the typed classification (always, when it came
      // from runServeCommand). Untyped throws fall back to a generic
      // reason + no remediation.
      this.tailnetServeDegradation = isServeFailureError(error)
        ? {
            reason: error.classification.message,
            remediation: error.classification.remediation,
          }
        : { reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Resolve the stable Tailnet port to publish on. Reads the env var if
   * set, otherwise falls back to {@link DEFAULT_TAILNET_PORT}.
   * @returns the resolved port number
   */
  private resolveTailnetPort(): number {
    const raw = process.env[DesktopEnvVars.FELAFEL_ORCHESTRATOR_TAILNET_PORT];
    return raw ? Number(raw) : DEFAULT_TAILNET_PORT;
  }

  /**
   * Read the captured tailnet-serve degradation from the most recent
   * `start()`. Null when start() succeeded cleanly OR when no Tailscale
   * setup was attempted (e.g. host has no Tailscale daemon). The desktop
   * main process reads this AFTER `start()` resolves and attaches it to
   * the OrchestratorStatus ready broadcast.
   * @returns the degradation if `setupTailnetServe` failed during the
   * last successful start(), else null
   */
  getServeDegradation(): TailnetServeDegradation | null {
    return this.tailnetServeDegradation;
  }

  /**
   * Stop the orchestrator child gracefully. SIGTERM first, then SIGKILL
   * after {@link SIGTERM_GRACE_MS} if it hasn't exited. Idempotent — calling
   * when nothing is running is a no-op.
   */
  async stop(): Promise<void> {
    const proc = this.process;
    if (!proc) {
      return;
    }
    this.process = null;
    // Clear the bound-port memo so any refresh that races with shutdown
    // sees "no orchestrator" rather than attempting a publish against a
    // port the child is no longer listening on.
    this.currentLocalPort = null;
    // Kill the child first — that part is idempotent (kill on a dead PID
    // is a no-op, the SIGKILL escalation handles the slow-exit case). Then
    // unpublish the tailnet serve mapping; let any failure propagate so
    // the caller (desktop main's before-quit handler) sees it instead of
    // a swallowed log line. The brief window where the mapping points at
    // a dying loopback port is acceptable — Tailscale clients see a
    // connection refused, not stale data.
    // Ask politely first; execa's `forceKillAfterDelay` (set in
    // start()) handles the SIGKILL escalation if the child hangs.
    // Awaiting the subprocess promise resolves on exit (any signal).
    proc.kill("SIGTERM");
    await proc;
    // Only unpublish if we actually published in the matching start().
    // setupTailnetServe sets `publishedTailnetPort` after a successful
    // publish; on Tailscale-less hosts or when the publish failed the
    // field stays null and we skip the unpublish (which would otherwise
    // throw "binary not found" on a host that never had Tailscale).
    const tailnetPort = this.publishedTailnetPort;
    if (tailnetPort !== null) {
      this.publishedTailnetPort = null;
      await this.tailscale.unpublishServe({ tailnetPort });
    }
  }

}
