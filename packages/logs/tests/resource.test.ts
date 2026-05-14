import { hostname } from "node:os";

import { describe, expect, it } from "vitest";

import { createTelemetryResource } from "@felafel/logs";

describe("createTelemetryResource", () => {
  it("builds an OTel Resource with service.name = service and service.instance.id = hostname (C6)", () => {
    const resource = createTelemetryResource("felafel-worker");
    const attrs = resource.attributes;

    expect(attrs["service.name"]).toBe("felafel-worker");
    expect(attrs["service.instance.id"]).toBe(hostname());
  });

  it("uses an explicit version when provided", () => {
    const resource = createTelemetryResource("felafel-worker", "1.2.3");
    expect(resource.attributes["service.version"]).toBe("1.2.3");
  });
});
