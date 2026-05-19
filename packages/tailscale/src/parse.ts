// Pure parsers for `tailscale status --json` and `tailscale serve status
// --json`. No IO, no spawn — given a stdout string they return a typed
// shape (or null / a discriminated "error" status). Lives outside
// `manager.ts` so the TailscaleManager class stays under the 300-line
// source-file cap and so these helpers can be tested in isolation
// without instantiating the manager. See PAI-140.
import { z } from "zod";
import type { Logger } from "@felafel/logs";
import { type TailscaleStatus } from "@felafel/shared";
import { STDERR_PREVIEW_MAX_LEN } from "@felafel/tailscale/constants";

/** Maximum valid TCP/UDP port number per RFC 793. */
const MAX_PORT_NUMBER = 65535;

/**
 * Zod schema for a TCP forward entry inside `tailscale serve`'s ServeConfig
 * JSON. We only care about the `TCPForward: "host:port"` shape — HTTPS
 * termination and Web routes are ignored. Schema is intentionally narrow:
 * extra fields on the entry pass through untouched so a CLI version bump
 * doesn't break the parse.
 */
const ServeTcpEntrySchema = z.object({
  TCPForward: z
    .string()
    // "host:port" — split on the last colon so an IPv6 literal like
    // "[::1]:54321" still parses cleanly.
    .transform((value, ctx) => {
      const colon = value.lastIndexOf(":");
      if (colon === -1) {
        ctx.addIssue({ code: "custom", message: "TCPForward missing port" });
        return z.NEVER;
      }
      const port = Number(value.slice(colon + 1));
      if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT_NUMBER) {
        ctx.addIssue({ code: "custom", message: "TCPForward port out of range" });
        return z.NEVER;
      }
      return port;
    }),
});

/** Top-level shape of `tailscale serve status --json`. */
const ServeConfigSchema = z.object({
  TCP: z.record(z.string(), ServeTcpEntrySchema).optional(),
});

/**
 * Pure parser. Reads `tailscale status --json` stdout and maps BackendState
 * onto the discriminated `TailscaleStatus` union. The CLI emits valid JSON on
 * stdout even when exiting non-zero (e.g. NeedsLogin), so callers should pass
 * the stdout regardless of exit code.
 * @param stdout - raw stdout from `tailscale status --json`
 * @returns discriminated status; `kind: "error"` if the JSON is malformed
 */
export function parseStatusJson(stdout: string): TailscaleStatus {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null) {
      return { kind: "error", message: "Unexpected `tailscale status --json` shape" };
    }
    const obj = parsed as Record<string, unknown>;
    const backend = obj.BackendState;
    switch (backend) {
      case "Running": {
        const suffix = typeof obj.MagicDNSSuffix === "string" ? obj.MagicDNSSuffix : "";
        // Strip leading dot and any trailing .ts.net to keep the display name short.
        const tailnet = suffix.replace(/^\./u, "").replace(/\.ts\.net$/u, "") || "tailnet";
        const self = (obj.Self as Record<string, unknown> | undefined) ?? {};
        const selfName = typeof self.HostName === "string" ? self.HostName : "this machine";
        return { kind: "connected", tailnet, selfName };
      }
      case "NeedsLogin": {
        return { kind: "disconnected", reason: "needs-login" };
      }
      case "Stopped": {
        return { kind: "disconnected", reason: "stopped" };
      }
      case "NoState":
      case "Starting": {
        return { kind: "probing" };
      }
      default: {
        return { kind: "error", message: `Unexpected BackendState: ${String(backend)}` };
      }
    }
  } catch {
    return { kind: "error", message: "Could not parse `tailscale status --json` output" };
  }
}

/**
 * Pure parser. Reads `tailscale serve status --json` stdout and pulls out
 * the local TCPForward target for a specific Tailnet port. Returns null
 * when no such mapping exists (or the JSON is malformed) so callers can
 * use it both to detect "is anything published?" and "what's it pointing at?"
 *
 * The `tailscale serve` config schema (Tailscale's `ServeConfig` type) keys
 * TCP forwards by port-number-as-string and stores the local target as
 * `TCPForward: "host:port"`. Anything else (HTTPS termination, Web routes,
 * Funnel) is ignored — we only care about raw TCP forwarding here.
 * @param stdout - raw stdout from `tailscale serve status --json`
 * @param tailnetPort - the Tailnet-side port we want the mapping for
 * @param logger - service-bound logger for the malformed-output breadcrumb
 * @returns `{ targetLocalPort }` if a TCP forward exists for this port, else null
 */
export function parseServeConfigJson(
  stdout: string,
  tailnetPort: number,
  logger: Logger,
): { targetLocalPort: number } | null {
  try {
    const result = ServeConfigSchema.safeParse(JSON.parse(stdout));
    if (!result.success) {
      // Malformed shape from a CLI we shell out to is a real bug
      // (tailscale version mismatch, partial output, etc.). Return null
      // because the call-site treats absence and corruption the same way,
      // but log so the bug is observable instead of silently masked.
      logger.warn(
        { err: result.error.message },
        "tailscale.serve.parse.schema-failed",
      );
      return null;
    }
    const targetLocalPort = result.data.TCP?.[String(tailnetPort)]?.TCPForward;
    return targetLocalPort === undefined ? null : { targetLocalPort };
  } catch {
    logger.warn(
      { stdoutPreview: stdout.slice(0, STDERR_PREVIEW_MAX_LEN) },
      "tailscale.serve.parse.malformed",
    );
    return null;
  }
}
