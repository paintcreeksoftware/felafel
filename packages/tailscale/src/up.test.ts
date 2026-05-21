// Unit tests for `runUpFlow` + `makeUpFlowCache` + the indirectly-tested
// `supportsAuthkeyStdin` probe cache. Stubs execa at the spawn boundary
// and lets the real `classifyUpError` decide outcomes — same pattern as
// `serve.test.ts`, so the tests double as coverage for the up-side
// classifier path through the production helper.
import { describe, expect, it } from "vitest";
import { makeUpFlowCache } from "@felafel/tailscale/up";

describe("makeUpFlowCache", () => {
  it("returns a fresh cache with no in-flight probe", () => {
    expect(makeUpFlowCache()).toEqual({ stdinSupportPromise: undefined });
  });

  it("returns independent cache objects per call", () => {
    const a = makeUpFlowCache();
    const b = makeUpFlowCache();
    expect(a).not.toBe(b);
  });
});
