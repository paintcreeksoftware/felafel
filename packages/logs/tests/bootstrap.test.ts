import { afterAll, describe, expect, it } from "vitest";

import { bootstrap } from "@felafel/logs";

const { logger, sdk } = bootstrap({ service: "felafel-worker" });

afterAll(async () => {
  // Best-effort shutdown; auto-instrumentations can take a while, so cap at
  // 10s. If shutdown ever exceeds that, vitest fails — surfaces a hung
  // resource rather than letting it silently hold the suite open.
  await Promise.race([
    sdk.shutdown(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, 10_000);
    }),
  ]);
}, 15_000);

describe("bootstrap", () => {
  it("returns a logger pre-bound with the requested service + an SDK handle", () => {
    expect(logger.bindings().service).toBe("felafel-worker");
    expect(typeof sdk.shutdown).toBe("function");
  });

  it("forwards an explicit version into the logger's bindings", () => {
    const { logger: l } = bootstrap({
      service: "felafel-worker",
      version: "9.9.9",
    });
    expect(l.bindings().version).toBe("9.9.9");
  });
});
