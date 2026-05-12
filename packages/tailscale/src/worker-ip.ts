// Tiny wrapper around `tailscale ip -4`. Used by the worker entrypoint to
// auto-detect the local Tailnet IP for the advertised controlPlaneUrl when
// WORKER_HOST isn't set explicitly.
//
// Why not use the desktop's TailscaleManager: that lives in apps/desktop and
// pulls execa + which + zod. The worker just needs one CLI call returning
// one line of stdout — Node's built-in child_process.execFile covers it.
// If the worker grows a second Tailscale operation, lift this into a shared
// `packages/tailscale` package.
import { execFile } from "node:child_process";

/** 5-second cap on a single `tailscale ip -4` invocation. */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * Tiny Promise wrapper around `execFile` so the consumer below stays
 * `async/await`-shaped. Inlined instead of `util.promisify(execFile)`
 * because the latter's resolved shape depends on `util.promisify.custom`
 * being attached to the underlying function — fine for the real Node
 * builtin, surprising when the function is mocked in tests (the mock
 * loses the symbol and promisify returns a different shape).
 * @param args - argv passed to `execFile` after the binary name
 * @returns stdout string on exit code 0; rejects on non-zero or spawn error
 */
function runTailscale(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // oxlint-disable-next-line prefer-await-to-callbacks -- wrapping callback-style execFile
    execFile("tailscale", args, { timeout: PROBE_TIMEOUT_MS }, (err, stdout) => {
      if (err) {
        // execFile types `err` as `ExecFileException | null` (an Error
        // subtype) but TS doesn't narrow it across the callback boundary —
        // help `prefer-promise-reject-errors` see the Error shape. JSON
        // stringify the non-Error branch so a stray plain-object failure
        // doesn't collapse to `[object Object]`.
        reject(err instanceof Error ? err : new Error(JSON.stringify(err)));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * IPv4 dotted-quad with each octet 0-255 — strict enough that a stray
 * line in the output (or a non-IPv4 string) doesn't masquerade as an IP.
 */
const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/u;

/**
 * Resolve the local machine's Tailnet IPv4 address by shelling out to
 * `tailscale ip -4`. Returns null on any failure mode (binary missing,
 * not logged in, daemon down, malformed output) so the caller can
 * gracefully fall back to a different bind address without distinguishing
 * the failure modes.
 *
 * Trims the first line of stdout (the CLI prints the IP and a trailing
 * newline) and validates it against a strict IPv4 dotted-quad regex.
 * @returns the Tailnet IPv4 address, or null when unavailable for any reason
 */
export async function getTailnetIPv4(): Promise<string | null> {
  try {
    const stdout = await runTailscale(["ip", "-4"]);
    const candidate = stdout.split("\n")[0]?.trim();
    if (candidate && IPV4_REGEX.test(candidate)) {
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}
