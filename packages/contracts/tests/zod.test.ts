// Pin the wire-shape behavior of every schema in @felafel/contracts.
//
// These tests are the load-bearing equivalence proof for D2: when
// @felafel/shared starts re-exporting these schemas, the renderer / worker
// daemon / orchestrator should observe NO behavior change. Each test
// exercises a fixture matching the previous hand-authored shape from
// @felafel/shared and asserts it parses cleanly; refinement tests verify
// every guard (.uuid, .url, .min, enum) rejects the expected fault.

import { describe, expect, it } from "vitest";

import {
  JobAssignmentSchema,
  RunCompleteSchema,
  RunSchema,
  RunStatusSchema,
  WorkerArchSchema,
  WorkerOsSchema,
  WorkerRegistrationSchema,
  WorkerSchema,
  WorkerStatusSchema,
} from "@felafel/contracts";

// Fixtures conform to Zod 4's strict UUID format: version digit ∈ [1-8],
// variant digit ∈ [8, 9, a, b]. Picked from RFC 4122 v4 (random) shape.
const workerUuid = "11111111-2222-4333-8444-555555555555";
const runUuid = "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee";
const otherWorkerUuid = "99999999-8888-4777-a666-555555555555";

describe("WorkerRegistrationSchema", () => {
  it("accepts a minimal valid payload", () => {
    const parsed = WorkerRegistrationSchema.parse({
      id: workerUuid,
      hostname: "nuc-1",
      controlPlaneUrl: "http://100.64.0.1:7777",
    });
    expect(parsed).toEqual({
      id: workerUuid,
      hostname: "nuc-1",
      controlPlaneUrl: "http://100.64.0.1:7777",
    });
  });

  it("accepts every optional wire field", () => {
    const parsed = WorkerRegistrationSchema.parse({
      id: workerUuid,
      hostname: "nuc-1",
      tailscaleName: "nuc-1.tail0abcd.ts.net",
      os: "linux",
      arch: "x64",
      version: "0.1.0",
      labels: { tier: "compute", region: "lan" },
      controlPlaneUrl: "http://100.64.0.1:7777",
    });
    expect(parsed.id).toBe(workerUuid);
    expect(parsed.os).toBe("linux");
    expect(parsed.labels).toEqual({ tier: "compute", region: "lan" });
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      WorkerRegistrationSchema.parse({
        id: "not-a-uuid",
        hostname: "nuc-1",
        controlPlaneUrl: "http://100.64.0.1:7777",
      }),
    ).toThrow();
  });

  it("rejects a non-url controlPlaneUrl", () => {
    expect(() =>
      WorkerRegistrationSchema.parse({
        id: workerUuid,
        hostname: "nuc-1",
        controlPlaneUrl: "not-a-url",
      }),
    ).toThrow();
  });

  it("rejects an empty hostname", () => {
    expect(() =>
      WorkerRegistrationSchema.parse({
        id: workerUuid,
        hostname: "",
        controlPlaneUrl: "http://100.64.0.1:7777",
      }),
    ).toThrow();
  });

  it("rejects an unknown os value", () => {
    expect(() =>
      WorkerRegistrationSchema.parse({
        id: workerUuid,
        hostname: "nuc-1",
        os: "freebsd",
        controlPlaneUrl: "http://100.64.0.1:7777",
      }),
    ).toThrow();
  });
});

describe("WorkerSchema", () => {
  const validInput = {
    id: workerUuid,
    hostname: "nuc-1",
    controlPlaneUrl: "http://100.64.0.1:7777",
    status: "active" as const,
    registeredAt: "2026-05-02T00:00:00.000Z",
    lastSeenAt: "2026-05-02T00:00:30.000Z",
  };

  it("accepts a fully-populated row", () => {
    const parsed = WorkerSchema.parse(validInput);
    expect(parsed.id).toBe(workerUuid);
    expect(parsed.status).toBe("active");
  });

  it("rejects a non-iso registeredAt", () => {
    expect(() =>
      WorkerSchema.parse({ ...validInput, registeredAt: "yesterday" }),
    ).toThrow();
  });

  it("rejects an unknown status", () => {
    expect(() =>
      WorkerSchema.parse({ ...validInput, status: "draining" }),
    ).toThrow();
  });
});

describe("WorkerStatusSchema", () => {
  it("accepts the two known states", () => {
    expect(WorkerStatusSchema.parse("active")).toBe("active");
    expect(WorkerStatusSchema.parse("stale")).toBe("stale");
  });

  it("rejects anything else", () => {
    expect(() => WorkerStatusSchema.parse("draining")).toThrow();
  });
});

describe("WorkerOsSchema and WorkerArchSchema", () => {
  it.each(["linux", "darwin", "win32"])("accepts os %s", (os) => {
    expect(WorkerOsSchema.parse(os)).toBe(os);
  });

  it("rejects unknown os values", () => {
    expect(() => WorkerOsSchema.parse("freebsd")).toThrow();
  });

  it.each(["x64", "arm64"])("accepts arch %s", (arch) => {
    expect(WorkerArchSchema.parse(arch)).toBe(arch);
  });

  it("rejects unknown arch values", () => {
    expect(() => WorkerArchSchema.parse("riscv")).toThrow();
  });
});

describe("RunSchema", () => {
  const validInput = {
    id: runUuid,
    payload: { kind: "noop" },
    status: "pending" as const,
    createdAt: "2026-05-02T00:00:00.000Z",
  };

  it("accepts a minimal pending run", () => {
    const parsed = RunSchema.parse(validInput);
    expect(parsed).toEqual({
      id: runUuid,
      payload: { kind: "noop" },
      status: "pending",
      createdAt: "2026-05-02T00:00:00.000Z",
    });
  });

  it("accepts a complete run with worker + timestamps", () => {
    const parsed = RunSchema.parse({
      ...validInput,
      status: "complete",
      workerId: otherWorkerUuid,
      dispatchedAt: "2026-05-02T00:00:01.000Z",
      completedAt: "2026-05-02T00:00:05.000Z",
    });
    expect(parsed.workerId).toBe(otherWorkerUuid);
    expect(parsed.status).toBe("complete");
  });

  it("rejects an unknown status", () => {
    expect(() => RunSchema.parse({ ...validInput, status: "queued" })).toThrow();
  });
});

describe("RunStatusSchema", () => {
  it.each(["pending", "dispatched", "complete", "failed"])(
    "accepts %s",
    (status) => {
      expect(RunStatusSchema.parse(status)).toBe(status);
    },
  );

  it("rejects anything else", () => {
    expect(() => RunStatusSchema.parse("queued")).toThrow();
  });
});

describe("JobAssignmentSchema", () => {
  it("accepts a runId + payload pair", () => {
    expect(
      JobAssignmentSchema.parse({ runId: runUuid, payload: { kind: "noop" } }),
    ).toEqual({ runId: runUuid, payload: { kind: "noop" } });
  });

  it("rejects a non-uuid runId", () => {
    expect(() =>
      JobAssignmentSchema.parse({ runId: "x", payload: {} }),
    ).toThrow();
  });
});

describe("RunCompleteSchema", () => {
  it("accepts the success shape", () => {
    expect(
      RunCompleteSchema.parse({ ok: true, result: { exit: 0 } }),
    ).toEqual({ ok: true, result: { exit: 0 } });
  });

  it("accepts the failure shape", () => {
    expect(RunCompleteSchema.parse({ ok: false, error: "boom" })).toEqual({
      ok: false,
      error: "boom",
    });
  });

  it("rejects a non-boolean ok", () => {
    expect(() => RunCompleteSchema.parse({ ok: "yes" })).toThrow();
  });
});
