// Tier 2 — integration test for tailscale.ts. Spawns the real `tailscale`
// binary on the host (read-only — does NOT call runUp because that would
// burn auth keys and mutate tailnet membership).
//
// Auto-skips on hosts without Tailscale installed so this test file is safe
// to leave in the always-on test suite, though it lives outside the default
// `pnpm test` glob and only runs via `pnpm test:integration`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  _resetTailscaleStateForTests,
  findBinary,
  probeStatus,
} from "./tailscale";

let binaryAvailable = false;

beforeAll(async () => {
  _resetTailscaleStateForTests();
  binaryAvailable = (await findBinary({ refresh: true })) !== null;
});

afterAll(() => {
  _resetTailscaleStateForTests();
});

describe("probeStatus (integration)", () => {
  it.skipIf(!binaryAvailable)("returns a well-formed TailscaleStatus", async () => {
    const status = await probeStatus();
    // Whichever state the host is in, the result should be one of the
    // discriminated-union members. We don't assert which one — that depends
    // on whether the dev box is logged into a tailnet.
    expect(status).toHaveProperty("kind");
    const validKinds = [
      "unknown",
      "probing",
      "connected",
      "disconnected",
      "error",
      "missing-binary",
    ];
    expect(validKinds).toContain(status.kind);
    if (status.kind === "connected") {
      expect(typeof status.tailnet).toBe("string");
      expect(typeof status.selfName).toBe("string");
    }
  }, 10_000);
});
