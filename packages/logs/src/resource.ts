import { hostname } from "node:os";

import { resourceFromAttributes, type Resource } from "@opentelemetry/resources";

import type { Service } from "@felafel/logs";

/**
 * Build the OpenTelemetry `Resource` that identifies a Felafel service
 * to a downstream collector. The resource's `service.name` matches the
 * same `Service` union the logger's `service` binding uses, so logs
 * and traces share identity (PAI-168 C6). `service.instance.id` matches
 * the logger's `node` binding (host hostname), so worker-1 vs worker-2
 * are distinguishable in both streams.
 * @param service - Service identity from the union.
 * @returns A configured OTel `Resource`.
 */
export function createTelemetryResource(service: Service): Resource {
  return resourceFromAttributes({
    "service.name": service,
    "service.instance.id": hostname(),
    "service.version": process.env.npm_package_version,
  });
}
