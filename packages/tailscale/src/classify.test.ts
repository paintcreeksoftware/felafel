// Tier 1 — unit tests for the pure error classifiers in classify.ts.
// Runs in milliseconds, no `tailscale` binary required.
import { describe, expect, it } from "vitest";
import { createLogger, Service } from "@felafel/logs";
import { classifyServeError, classifyUpError } from "@felafel/tailscale/classify";

const testLogger = createLogger({ service: Service.DESKTOP_MAIN });

describe("classifyUpError", () => {
  it("returns timeout when timedOut=true regardless of stderr content", () => {
    expect(classifyUpError("permission denied", 1, true, testLogger)).toMatchObject({ kind: "timeout" });
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
    expect(classifyUpError("EACCES while opening socket", 1, false, testLogger)).toMatchObject({
      kind: "eacces",
    });
  });

  it("classifies tailscaled.sock connect failures as no-daemon", () => {
    expect(
      classifyUpError("dial unix /var/run/tailscale/tailscaled.sock: no such file", 1, false, testLogger),
    ).toMatchObject({ kind: "no-daemon" });
  });

  it("captures the auth URL and classifies as needs-login", () => {
    const stderr =
      "To authenticate, visit:\n\n  https://login.tailscale.com/a/abc123def456\n\n";
    const result = classifyUpError(stderr, 1, false, testLogger);
    expect(result).toMatchObject({
      kind: "needs-login",
      authUrl: "https://login.tailscale.com/a/abc123def456",
    });
  });

  it("classifies invalid auth key stderr as invalid-key", () => {
    expect(classifyUpError("invalid auth key: rejected by control", 1, false, testLogger)).toMatchObject({
      kind: "invalid-key",
    });
    expect(classifyUpError("unauthorized: key has been revoked", 1, false, testLogger)).toMatchObject({
      kind: "invalid-key",
    });
  });

  it("falls through to unknown for unmatched stderr", () => {
    expect(classifyUpError("something completely unexpected", 7, false, testLogger)).toMatchObject({
      kind: "unknown",
    });
  });

  it("EACCES wins over auth-url when both appear", () => {
    const stderr =
      "permission denied; would visit https://login.tailscale.com/a/abc but cannot";
    expect(classifyUpError(stderr, 1, false, testLogger)).toMatchObject({ kind: "eacces" });
  });
});

describe("classifyServeError", () => {
  it("returns timeout when timedOut=true regardless of stderr content", () => {
    expect(classifyServeError("permission denied", 1, true, testLogger)).toMatchObject({ kind: "timeout" });
  });

  it("classifies 'permission denied' stderr as eacces", () => {
    expect(
      classifyServeError(
        "tailscale: permission denied on /var/run/tailscale/tailscaled.sock",
        1,
        false,
      ),
    ).toMatchObject({ kind: "eacces" });
  });

  it("classifies 'Access denied' stderr as eacces with the operator-setup remediation", () => {
    // Real stderr from `tailscale serve` v1.96 when the user hasn't yet
    // run `sudo tailscale set --operator=$USER`. Surfaced during PR #31
    // smoke test on bare metal.
    const result = classifyServeError(
      "sending serve config: Access denied: serve config denied",
      1,
      false,
    );
    expect(result).toMatchObject({
      kind: "eacces",
      remediation: "sudo tailscale set --operator=$USER",
    });
  });

  it("classifies tailscaled.sock connect failures as no-daemon", () => {
    expect(
      classifyServeError("dial unix /var/run/tailscale/tailscaled.sock: no such file", 1, false, testLogger),
    ).toMatchObject({ kind: "no-daemon" });
  });

  it("classifies 'address already in use' as port-in-use", () => {
    expect(classifyServeError("listen tcp :9090: address already in use", 1, false, testLogger)).toMatchObject({
      kind: "port-in-use",
    });
  });

  it("classifies 'already serving on port' as port-in-use", () => {
    expect(classifyServeError("port 9090 already serving", 1, false, testLogger)).toMatchObject({
      kind: "port-in-use",
    });
  });

  it("falls through to unknown for unmatched stderr", () => {
    expect(classifyServeError("something completely unexpected", 7, false, testLogger)).toMatchObject({
      kind: "unknown",
    });
  });

  it("EACCES wins over port-in-use when both phrases appear", () => {
    expect(
      classifyServeError("permission denied while binding port already in use", 1, false, testLogger),
    ).toMatchObject({ kind: "eacces" });
  });
});
