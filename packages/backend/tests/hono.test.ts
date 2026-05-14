import { afterAll, describe, expect, it } from "vitest";

import { createHonoApp } from "@felafel/backend";

const { app, sdk, logger } = createHonoApp({ service: "felafel-orchestrator" });

afterAll(async () => {
  // Best-effort shutdown; auto-instrumentations can take a while.
  await Promise.race([
    sdk.shutdown(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, 10_000);
    }),
  ]);
}, 15_000);

describe("createHonoApp", () => {
  it("returns an app pre-wired with cors + request-logger middleware (C3)", async () => {
    app.get("/ping", (c) => c.json({ ok: true }));

    const res = await app.request("/ping", {
      headers: { Origin: "https://example.test" },
    });
    expect(res.status).toBe(200);
    // CORS middleware sets Access-Control-Allow-Origin (default: '*').
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns the parent logger pre-bound with the requested service", () => {
    expect(logger.bindings().service).toBe("felafel-orchestrator");
  });
});
