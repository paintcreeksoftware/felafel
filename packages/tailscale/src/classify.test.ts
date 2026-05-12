// Tier 1 — unit tests for the pure error classifiers in classify.ts.
// Runs in milliseconds, no `tailscale` binary required.
import { describe, expect, it } from "vitest";
import { classifyUpError } from "@felafel/tailscale/classify";

describe("classifyUpError", () => {
  it("returns timeout when timedOut=true regardless of stderr content", () => {
    expect(classifyUpError("permission denied", 1, true)).toMatchObject({ kind: "timeout" });
  });

  it("classifies 'permission denied' stderr as eacces", () => {
    expect(
      classifyUpError(
        "tailscale: failed to connect: permission denied on /var/run/tailscale/tailscaled.sock",
        1,
        false,
      ),
    ).toMatchObject({ kind: "eacces" });
  });

  it("classifies bare EACCES as eacces", () => {
    expect(classifyUpError("EACCES while opening socket", 1, false)).toMatchObject({
      kind: "eacces",
    });
  });

  it("classifies tailscaled.sock connect failures as no-daemon", () => {
    expect(
      classifyUpError("dial unix /var/run/tailscale/tailscaled.sock: no such file", 1, false),
    ).toMatchObject({ kind: "no-daemon" });
  });

  it("captures the auth URL and classifies as needs-login", () => {
    const stderr =
      "To authenticate, visit:\n\n  https://login.tailscale.com/a/abc123def456\n\n";
    const result = classifyUpError(stderr, 1, false);
    expect(result).toMatchObject({
      kind: "needs-login",
      authUrl: "https://login.tailscale.com/a/abc123def456",
    });
  });

  it("classifies invalid auth key stderr as invalid-key", () => {
    expect(classifyUpError("invalid auth key: rejected by control", 1, false)).toMatchObject({
      kind: "invalid-key",
    });
    expect(classifyUpError("unauthorized: key has been revoked", 1, false)).toMatchObject({
      kind: "invalid-key",
    });
  });

  it("falls through to unknown for unmatched stderr", () => {
    expect(classifyUpError("something completely unexpected", 7, false)).toMatchObject({
      kind: "unknown",
    });
  });

  it("EACCES wins over auth-url when both appear", () => {
    const stderr =
      "permission denied; would visit https://login.tailscale.com/a/abc but cannot";
    expect(classifyUpError(stderr, 1, false)).toMatchObject({ kind: "eacces" });
  });
});
