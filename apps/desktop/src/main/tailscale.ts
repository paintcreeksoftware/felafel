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
import { execFile, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import which from "which";
import type { TailscaleConnectResult, TailscaleStatus } from "@felafel/shared";

const execFileAsync = promisify(execFile);

let cachedBinary: string | null | undefined;
let cachedStatus: TailscaleStatus = { kind: "unknown" };
let probeInflight: Promise<TailscaleStatus> | null = null;
let upInflight: Promise<TailscaleConnectResult> | null = null;
let stdinSupportCache: boolean | undefined;

// Resolve the `tailscale` binary on PATH. Falls back to FELAFEL_TAILSCALE_FAKE
// when set so E2E tests can inject a fixture script at the boundary instead
// of mocking spawn.
export async function findBinary(opts: { refresh?: boolean } = {}): Promise<string | null> {
  if (process.env.FELAFEL_TAILSCALE_FAKE) {
    return process.env.FELAFEL_TAILSCALE_FAKE;
  }
  if (cachedBinary !== undefined && !opts.refresh) {
    return cachedBinary;
  }
  cachedBinary = await which("tailscale", { nothrow: true });
  return cachedBinary;
}

export function getCachedStatus(): TailscaleStatus {
  return cachedStatus;
}

// Pure parser. Reads `tailscale status --json` stdout and maps BackendState
// onto the union. The CLI emits valid JSON on stdout even when exiting
// non-zero (e.g. NeedsLogin), so callers should pass the stdout regardless
// of exit code.
export function parseStatusJson(stdout: string): TailscaleStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { kind: "error", message: "Could not parse `tailscale status --json` output" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "error", message: "Unexpected `tailscale status --json` shape" };
  }
  const obj = parsed as Record<string, unknown>;
  const backend = obj["BackendState"];
  switch (backend) {
    case "Running": {
      const suffix = typeof obj["MagicDNSSuffix"] === "string" ? obj["MagicDNSSuffix"] : "";
      // Strip leading dot and any trailing .ts.net to keep the display name short.
      const tailnet = suffix.replace(/^\./, "").replace(/\.ts\.net$/, "") || "tailnet";
      const self = (obj["Self"] as Record<string, unknown> | undefined) ?? {};
      const selfName = typeof self["HostName"] === "string" ? self["HostName"] : "this machine";
      return { kind: "connected", tailnet, selfName };
    }
    case "NeedsLogin":
      return { kind: "disconnected", reason: "needs-login" };
    case "Stopped":
      return { kind: "disconnected", reason: "stopped" };
    case "NoState":
    case "Starting":
      return { kind: "probing" };
    default:
      return { kind: "error", message: `Unexpected BackendState: ${String(backend)}` };
  }
}

// Pure classifier. Reads stderr/stdout from `tailscale up` and decides which
// failure mode we're in. Priority order matters — EACCES is most actionable
// so it wins over auth-url even if both somehow appear.
export interface UpErrorClassification {
  kind: "eacces" | "needs-login" | "invalid-key" | "no-daemon" | "timeout" | "unknown";
  message: string;
  authUrl?: string;
}

export function classifyUpError(
  stderr: string,
  exitCode: number | null,
  timedOut: boolean,
): UpErrorClassification {
  if (timedOut) {
    return {
      kind: "timeout",
      message: "Tailscale didn't respond — check your network and try again.",
    };
  }
  if (/permission denied|\bEACCES\b/i.test(stderr)) {
    return {
      kind: "eacces",
      message: "Felafel doesn't have permission to talk to the Tailscale daemon socket.",
    };
  }
  if (/(failed to connect.*tailscaled|tailscaled\.sock)/i.test(stderr)) {
    return {
      kind: "no-daemon",
      message: "The tailscaled daemon isn't running on this machine.",
    };
  }
  const authUrlMatch = stderr.match(/https?:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9]+/);
  if (authUrlMatch) {
    return {
      kind: "needs-login",
      message: "Session couldn't resume — paste a Tailscale pre-auth key.",
      authUrl: authUrlMatch[0],
    };
  }
  if (/invalid (auth )?key|unauthorized/i.test(stderr)) {
    return {
      kind: "invalid-key",
      message: "Tailscale rejected the auth key — check it isn't expired or revoked.",
    };
  }
  console.warn("[tailscale] Unmatched stderr from tailscale up:", stderr.slice(0, 500));
  return {
    kind: "unknown",
    message: stderr.trim().slice(0, 500) || `tailscale up exited with code ${exitCode}`,
  };
}

// Probe the daemon's state. Concurrency-guarded — concurrent calls share the
// same in-flight promise. Retries up to 3× with 200/500/1500ms backoff on
// transient errors (EAGAIN, AbortError, etc.); deterministic errors (EACCES,
// missing-binary) are returned immediately without retry.
export async function probeStatus(): Promise<TailscaleStatus> {
  if (probeInflight) return probeInflight;
  probeInflight = doProbe().finally(() => {
    probeInflight = null;
  });
  return probeInflight;
}

const PROBE_RETRY_DELAYS_MS = [200, 500, 1500];

async function doProbe(): Promise<TailscaleStatus> {
  const binary = await findBinary();
  if (!binary) {
    cachedStatus = { kind: "missing-binary", path: null };
    return cachedStatus;
  }
  for (let attempt = 0; attempt <= PROBE_RETRY_DELAYS_MS.length; attempt++) {
    const result = await tryProbeOnce(binary);
    const isTransient =
      result.kind === "error" && /EAGAIN|ETIMEDOUT|aborted/i.test(result.message);
    if (!isTransient || attempt === PROBE_RETRY_DELAYS_MS.length) {
      cachedStatus = result;
      return cachedStatus;
    }
    await sleep(PROBE_RETRY_DELAYS_MS[attempt]);
  }
  return cachedStatus;
}

async function tryProbeOnce(binary: string): Promise<TailscaleStatus> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const result = await execFileAsync(binary, ["status", "--json"], { signal: ac.signal });
    return parseStatusJson(result.stdout);
  } catch (err: unknown) {
    // tailscale status exits non-zero when not logged in but still emits valid
    // JSON on stdout — try parsing before giving up.
    const e = err as { stdout?: unknown; stderr?: unknown; message?: string; code?: string };
    if (typeof e.stdout === "string" && e.stdout.length > 0) {
      const parsed = parseStatusJson(e.stdout);
      if (parsed.kind !== "error") return parsed;
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
    return { kind: "error", message: e.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// Run `tailscale up`. With no key: try session resume (5s timeout). With a
// key: pipe via stdin (30s timeout). The outer 60s AbortController is a
// safety net that always wins.
export async function runUp(authkey?: string): Promise<TailscaleConnectResult> {
  if (upInflight) {
    return { ok: false, kind: "error", message: "Connect already in progress" };
  }
  upInflight = doRunUp(authkey).finally(() => {
    upInflight = null;
  });
  return upInflight;
}

async function doRunUp(authkey?: string): Promise<TailscaleConnectResult> {
  const binary = await findBinary();
  if (!binary) {
    return {
      ok: false,
      kind: "error",
      message: "Tailscale binary not found on PATH",
    };
  }
  const ac = new AbortController();
  const outerTimer = setTimeout(() => ac.abort(), 60_000);
  try {
    let captured: { stdout: string; stderr: string; exitCode: number | null };
    let timedOut = false;
    try {
      if (authkey) {
        const useStdin = await supportsAuthkeyStdin(binary);
        if (!useStdin) {
          console.warn(
            "[tailscale] --authkey-stdin not supported by installed CLI; falling back to --authkey= (leaks the key via /proc/<pid>/cmdline)",
          );
        }
        const args = useStdin
          ? ["up", "--timeout=30s", "--authkey-stdin"]
          : ["up", "--timeout=30s", `--authkey=${authkey}`];
        captured = await spawnAndCapture(binary, args, useStdin ? authkey : undefined, ac.signal);
      } else {
        captured = await spawnAndCapture(binary, ["up", "--timeout=5s"], undefined, ac.signal);
      }
    } catch (err: unknown) {
      const e = err as { name?: string };
      if (e.name === "AbortError" || ac.signal.aborted) {
        timedOut = true;
        captured = { stdout: "", stderr: "", exitCode: null };
      } else {
        return {
          ok: false,
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }
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

interface CaptureResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function spawnAndCapture(
  binary: string,
  args: string[],
  stdin: string | undefined,
  signal: AbortSignal,
): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { signal });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
    if (stdin !== undefined) {
      child.stdin?.write(stdin);
      child.stdin?.end();
    }
  });
}

async function supportsAuthkeyStdin(binary: string): Promise<boolean> {
  if (stdinSupportCache !== undefined) return stdinSupportCache;
  try {
    const { stdout, stderr } = await execFileAsync(binary, ["up", "--help"]);
    stdinSupportCache = /--authkey-stdin/.test(stdout) || /--authkey-stdin/.test(stderr);
  } catch {
    stdinSupportCache = false;
  }
  return stdinSupportCache;
}

// Test-only reset for tailscale module state. Vitest tests call this between
// it() blocks so cached binary, status, and stdin-support detection don't
// leak across cases.
export function _resetTailscaleStateForTests(): void {
  cachedBinary = undefined;
  cachedStatus = { kind: "unknown" };
  probeInflight = null;
  upInflight = null;
  stdinSupportCache = undefined;
}
