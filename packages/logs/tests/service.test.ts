import { describe, expect, it } from "vitest";

import { type Service, Service as ServiceConst } from "@felafel/logs";

describe("Service const", () => {
  it("members are assignable to the Service union (PAI-168 C6)", () => {
    // Compile-time check: the `satisfies` constraint inside index.ts
    // already guarantees every member is a valid Service. This runtime
    // assertion exists so refactors that drop a member without updating
    // the type fail the test suite, not just type-check.
    const all: Service[] = [
      ServiceConst.ORCHESTRATOR,
      ServiceConst.DESKTOP_MAIN,
      ServiceConst.DESKTOP_RENDERER,
      ServiceConst.WORKER,
    ];
    expect(all).toHaveLength(4);
    expect(new Set(all).size).toBe(4);
  });

  it("string values match the union literals", () => {
    expect(ServiceConst.ORCHESTRATOR).toBe("felafel-orchestrator");
    expect(ServiceConst.DESKTOP_MAIN).toBe("felafel-desktop-main");
    expect(ServiceConst.DESKTOP_RENDERER).toBe("felafel-desktop-renderer");
    expect(ServiceConst.WORKER).toBe("felafel-worker");
  });
});
