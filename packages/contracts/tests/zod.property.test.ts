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

/**
 * Simulate wire serialization: every payload these schemas describe
 * crosses an HTTP or IPC boundary that goes through JSON. Use this in
 * round-trip properties instead of `structuredClone` — the lint rule
 * prefers the latter for generic deep-clone, but our intent is to
 * verify schemas survive the JSON loss model specifically.
 */
const wireRoundTrip = <T>(value: T): unknown =>
  // eslint-disable-next-line unicorn/prefer-structured-clone -- intentional JSON wire simulation
  JSON.parse(JSON.stringify(value));

// Wire-roundtrip identity: catches schemas that subtly transform input
// (e.g. a `.transform()` that strips a field, or a `.default()` that
// silently fills in a missing one). For the current contract surface —
// string-typed wire schemas with no transforms — round-trip is identity.
// If a future schema gains a transform, this property forces the author
// to update the test (or add a non-round-trip variant) deliberately.
describe("schema wire-roundtrip is identity for JSON-friendly fields", () => {
  test.prop([workerRegistrationArb()])("WorkerRegistrationSchema is a round-trip identity", (input) => {
    const roundTripped = WorkerRegistrationSchema.parse(wireRoundTrip(input));
    expect(roundTripped).toEqual(input);
  });

  test.prop([runArb()])("RunSchema is a round-trip identity", (input) => {
    const roundTripped = RunSchema.parse(wireRoundTrip(input));
    expect(roundTripped).toEqual(input);
  });
});
