// Property-based regression tests for the wire schemas in src/zod.ts.
// Complements the example-based tests in zod.test.ts: instead of asserting
// on hand-picked inputs, fast-check generates many random inputs per
// property and reports a minimal counter-example if one fails.
//
// Each test runs N=100 samples by default. Total file should stay under
// 1s. If a property turns out to be slow, lower the runs count via
// `{ numRuns: N }` rather than weakening the property.
//
// Arbitraries are hand-rolled rather than derived from the schema via
// zod-fast-check. Hand-rolled makes the reader's mental model explicit:
// "this generator says what 'a valid WorkerRegistration' looks like."
// If the schema and the arbitrary disagree, the sanity-check property
// catches it (canonical first property to add per schema).
import { test } from "@fast-check/vitest";
import {
  type Arbitrary,
  boolean,
  constantFrom,
  date,
  dictionary,
  jsonValue,
  pre,
  record,
  string,
  uuid,
  webUrl,
} from "fast-check";
import { describe, expect } from "vitest";

import {
  JobAssignmentSchema,
  RunCompleteSchema,
  RunSchema,
  WorkerRegistrationSchema,
  WorkerSchema,
} from "@felafel/contracts";

/**
 * Bound to 1970-9999 because Zod v4's `z.iso.datetime()` regex pins
 * the year to exactly 4 digits. Default `date()` happily produces
 * year 12345 or year -200, which serialize to ISO strings the schema
 * refuses to parse.
 */
const isoDatetime = (): Arbitrary<string> =>
  date({
    min: new Date("1970-01-01T00:00:00.000Z"),
    max: new Date("9999-12-31T23:59:59.999Z"),
    noInvalidDate: true,
  }).map((d) => d.toISOString());

const labels = (): Arbitrary<Record<string, string>> =>
  dictionary(string(), string(), { maxKeys: 5 });

// Shared between WorkerRegistration and Worker arbitraries — Worker
// extends WorkerRegistration with three more fields. Spread once at
// `record()` construction time below; lint flags merging via
// `.map(...spread)` and `Object.assign`.
const workerRegistrationFields = {
  id: uuid(),
  hostname: string({ minLength: 1, maxLength: 64 }),
  tailscaleName: string(),
  os: constantFrom("linux", "darwin", "win32"),
  arch: constantFrom("x64", "arm64"),
  version: string(),
  labels: labels(),
  controlPlaneUrl: webUrl(),
};

const workerRegistrationArb = (): Arbitrary<unknown> =>
  record(workerRegistrationFields, {
    requiredKeys: ["id", "hostname", "controlPlaneUrl"],
  });

const workerArb = (): Arbitrary<unknown> =>
  record(
    {
      ...workerRegistrationFields,
      status: constantFrom("active", "stale"),
      registeredAt: isoDatetime(),
      lastSeenAt: isoDatetime(),
    },
    {
      requiredKeys: ["id", "hostname", "controlPlaneUrl", "status", "registeredAt", "lastSeenAt"],
    },
  );

// Sanity properties: every value the arbitrary generates passes
// safeParse. Catches divergence between the arbitrary and the schema.
// Canonical first property to add when extending the file.
describe("schema arbitraries match their schemas", () => {
  test.prop([workerRegistrationArb()])("WorkerRegistrationSchema accepts every arbitrary", (input) => {
    expect(WorkerRegistrationSchema.safeParse(input).success).toBe(true);
  });

  test.prop([workerArb()])("WorkerSchema accepts every arbitrary", (input) => {
    expect(WorkerSchema.safeParse(input).success).toBe(true);
  });
});

const jsonRecord = (): Arbitrary<Record<string, unknown>> =>
  dictionary(string(), jsonValue(), { maxKeys: 5 });

const runArb = (): Arbitrary<unknown> =>
  record(
    {
      id: uuid(),
      payload: jsonRecord(),
      status: constantFrom("pending", "dispatched", "complete", "failed"),
      workerId: uuid(),
      error: string(),
      createdAt: isoDatetime(),
      dispatchedAt: isoDatetime(),
      completedAt: isoDatetime(),
    },
    {
      requiredKeys: ["id", "payload", "status", "createdAt"],
    },
  );

const jobAssignmentArb = (): Arbitrary<unknown> =>
  record({
    runId: uuid(),
    payload: jsonRecord(),
  });

const runCompleteArb = (): Arbitrary<unknown> =>
  record(
    {
      ok: boolean(),
      result: jsonRecord(),
      error: string(),
    },
    {
      requiredKeys: ["ok"],
    },
  );

describe("schema arbitraries match their schemas — runs", () => {
  test.prop([runArb()])("RunSchema accepts every arbitrary", (input) => {
    expect(RunSchema.safeParse(input).success).toBe(true);
  });

  test.prop([jobAssignmentArb()])("JobAssignmentSchema accepts every arbitrary", (input) => {
    expect(JobAssignmentSchema.safeParse(input).success).toBe(true);
  });

  test.prop([runCompleteArb()])("RunCompleteSchema accepts every arbitrary", (input) => {
    expect(RunCompleteSchema.safeParse(input).success).toBe(true);
  });
});

// Wire-roundtrip properties are deferred. The interesting form is
// "schema parse output is a fixed point under JSON serialization,"
// but pinning that down is tricky — fast-check finds JS-but-not-JSON
// edge values (`{"":-0}`, `{"__proto__":0}`, etc.) that distinguish
// JS-object equality from wire equality and require careful
// arbitrary filtering. Worth doing right in a follow-up; not a
// blocker for the v0 scaffold.

// Targeted rejection: pin a few fields to known-invalid values while
// letting the rest be arbitrary. Catches a future refactor that
// drops a refinement (e.g. `z.uuid()` → `z.string()`) — example
// tests that only use valid UUIDs would miss this. Preconditions
// (`pre()`) filter out coincidentally-valid second arbitraries.
describe("schema rejects malformed input on refined fields", () => {
  test.prop([workerRegistrationArb(), string({ minLength: 1, maxLength: 20 })])(
    "WorkerRegistrationSchema rejects non-UUID id",
    (base, nonUuid) => {
      pre(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(nonUuid));
      const result = WorkerRegistrationSchema.safeParse({ ...(base as object), id: nonUuid });
      expect(result.success).toBe(false);
    },
  );

  test.prop([workerRegistrationArb()])(
    "WorkerRegistrationSchema rejects empty hostname",
    (base) => {
      const result = WorkerRegistrationSchema.safeParse({ ...(base as object), hostname: "" });
      expect(result.success).toBe(false);
    },
  );
});
