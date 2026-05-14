import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { requestLoggerMiddleware } from "@felafel/backend";
import { createLogger } from "@felafel/logs";

interface LogLine {
  msg: string;
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
}

/**
 * In-memory pino destination — see `@felafel/logs` tests for rationale.
 * @returns A sink with `lines` and `write`.
 */
function makeSink(): { lines: LogLine[]; write: (chunk: string) => void } {
  const lines: LogLine[] = [];
  return {
    lines,
    write(chunk: string) {
      for (const raw of chunk.split("\n")) {
        if (raw.trim()) {
          lines.push(JSON.parse(raw) as LogLine);
        }
      }
    },
  };
}

describe("requestLoggerMiddleware", () => {
  it("emits request.start + request.complete with method, path, status, requestId, durationMs", async () => {
    const sink = makeSink();
    const logger = createLogger({ service: "felafel-orchestrator" }, sink);

    const app = new Hono();
    app.use("*", requestLoggerMiddleware(logger));
    app.get("/workers", (c) => c.json({ ok: true }));

    await app.request("/workers");

    const start = sink.lines.find((l) => l.msg === "request.start");
    const done = sink.lines.find((l) => l.msg === "request.complete");
    expect(start).toBeDefined();
    expect(done).toBeDefined();
    expect(start!.method).toBe("GET");
    expect(start!.path).toBe("/workers");
    expect(typeof start!.requestId).toBe("string");
    expect(done!.status).toBe(200);
    expect(typeof done!.durationMs).toBe("number");
    // start + complete share the same requestId.
    expect(done!.requestId).toBe(start!.requestId);
  });
});
