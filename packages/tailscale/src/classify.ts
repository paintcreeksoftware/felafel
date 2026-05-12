// Pure error classifiers for `tailscale up` and `tailscale serve` failures.
// Given a stderr blob + exit code + timeout flag, decide which failure
// mode we're in and surface a user-facing message (plus an actionable
// remediation when one is known). No IO, no spawn — testable in
// isolation. Lives outside `manager.ts` to keep the TailscaleManager
// class under the 300-line source-file cap. See PAI-140.
import { STDERR_PREVIEW_MAX_LEN } from "@felafel/tailscale/constants";

/** Classification of a `tailscale up` failure. */
export interface UpErrorClassification {
  kind: "eacces" | "needs-login" | "invalid-key" | "no-daemon" | "timeout" | "unknown";
  message: string;
  /** Auth URL extracted from stderr when `kind === "needs-login"`. */
  authUrl?: string;
}

/** Classification of a `tailscale serve` failure. */
export interface ServeErrorClassification {
  kind: "eacces" | "no-daemon" | "port-in-use" | "timeout" | "unknown";
  message: string;
  /**
   * Actionable one-liner the renderer can display verbatim. Currently
   * populated only for the `eacces` case (the operator-permission setup).
   */
  remediation?: string;
}

/**
 * Plain Error decorated with the structured serve-failure classification.
 * Used by `TailscaleManager.publishServe` (and `runServeCommand`) so
 * callers that want to surface a remediation hint can read
 * `error.classification.remediation` instead of re-parsing the message.
 */
export type ServeFailureError = Error & { classification: ServeErrorClassification };

/**
 * Type guard for a thrown error that carries a serve-failure classification.
 * Pairs with the throw inside `runServeCommand`. Implemented as a function
 * (not a class instanceof) so we don't burn a second class against the
 * file-class-limit lint rule for what is fundamentally a tagged Error.
 * @param error - the unknown caught from a try/catch
 * @returns true if the error carries a `classification` payload
 */
export function isServeFailureError(error: unknown): error is ServeFailureError {
  return error instanceof Error && "classification" in error;
}

/**
 * Match the "tailscaled daemon isn't running" stderr fingerprint without
 * a polynomial regex. Earlier revisions used
 * `/(failed to connect.*tailscaled|tailscaled\.sock)/i`, which CodeQL
 * (correctly) flags as ReDoS-vulnerable on `failed to connect…tailscaled`:
 * the `.*` can backtrack across repeated "failed to connect" prefixes.
 * Tailscale CLI stderr isn't attacker-controlled, but the string-includes
 * form is faster, clearer, and immune to the rule.
 * @param stderr - lowercased combined stderr from a `tailscale` invocation
 * @returns true if the stderr fingerprints the "daemon not running" case
 */
export function matchesNoDaemonStderr(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    s.includes("tailscaled.sock") ||
    (s.includes("failed to connect") && s.includes("tailscaled"))
  );
}

/**
 * Pure classifier. Reads stderr/stdout from `tailscale up` and decides which
 * failure mode we're in. Priority order matters — EACCES is most actionable
 * so it wins over auth-url even if both somehow appear.
 * @param stderr - combined stderr (stdout can be appended) from the CLI run
 * @param exitCode - CLI exit code, or null if it timed out
 * @param timedOut - true when the outer AbortController fired
 * @returns the classified failure
 */
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
  if (/permission denied|\bEACCES\b/iu.test(stderr)) {
    return {
      kind: "eacces",
      message: "Felafel doesn't have permission to talk to the Tailscale daemon socket.",
    };
  }
  if (matchesNoDaemonStderr(stderr)) {
    return {
      kind: "no-daemon",
      message: "The tailscaled daemon isn't running on this machine.",
    };
  }
  const authUrlMatch = stderr.match(/https?:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9]+/u);
  if (authUrlMatch) {
    return {
      kind: "needs-login",
      message: "Session couldn't resume — paste a Tailscale pre-auth key.",
      authUrl: authUrlMatch[0],
    };
  }
  if (/invalid (?:auth )?key|unauthorized/iu.test(stderr)) {
    return {
      kind: "invalid-key",
      message: "Tailscale rejected the auth key — check it isn't expired or revoked.",
    };
  }
  console.warn("[tailscale] Unmatched stderr from tailscale up:", stderr.slice(0, STDERR_PREVIEW_MAX_LEN));
  return {
    kind: "unknown",
    message: stderr.trim().slice(0, STDERR_PREVIEW_MAX_LEN) || `tailscale up exited with code ${exitCode}`,
  };
}

/**
 * Pure classifier. Reads stderr/stdout from `tailscale serve` and decides
 * which failure mode we're in. Mirrors {@link classifyUpError}'s priority
 * ordering — EACCES wins over everything else because it's the most
 * actionable.
 * @param stderr - combined stderr (stdout can be appended) from the CLI run
 * @param exitCode - CLI exit code, or null if it timed out
 * @param timedOut - true when the outer AbortController fired
 * @returns the classified failure
 */
export function classifyServeError(
  stderr: string,
  exitCode: number | null,
  timedOut: boolean,
): ServeErrorClassification {
  if (timedOut) {
    return {
      kind: "timeout",
      message: "Tailscale didn't respond — check your network and try again.",
    };
  }
  // `tailscale serve`'s actual stderr on first-run-without-operator-setup is
  // "Access denied: serve config denied" — the older `permission denied` /
  // `EACCES` patterns are still in for the daemon-socket-EACCES case and
  // forward compatibility with other Tailscale versions.
  if (/access denied|permission denied|\bEACCES\b/iu.test(stderr)) {
    return {
      kind: "eacces",
      message: "Felafel doesn't have permission to talk to the Tailscale daemon socket.",
      remediation: "sudo tailscale set --operator=$USER",
    };
  }
  if (matchesNoDaemonStderr(stderr)) {
    return {
      kind: "no-daemon",
      message: "The tailscaled daemon isn't running on this machine.",
    };
  }
  // Split into a bounded alternation + an explicit `address`/`in use`
  // co-occurrence check. The previous combined regex tripped CodeQL's
  // js/polynomial-redos rule on `address.*in use` (the `.*` could
  // backtrack across many "address" substrings).
  const stderrLower = stderr.toLowerCase();
  if (
    /already (?:in use|configured|serving)/iu.test(stderr) ||
    (stderrLower.includes("address") && stderrLower.includes("in use"))
  ) {
    return {
      kind: "port-in-use",
      message: "That Tailnet port is already published by another process.",
    };
  }
  console.warn("[tailscale] Unmatched stderr from tailscale serve:", stderr.slice(0, STDERR_PREVIEW_MAX_LEN));
  return {
    kind: "unknown",
    message: stderr.trim().slice(0, STDERR_PREVIEW_MAX_LEN) || `tailscale serve exited with code ${exitCode}`,
  };
}
