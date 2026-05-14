import { describe, expect, it } from "vitest";

import { createLogger, withTracedOperation } from "@felafel/logs";

interface LogLine {
  msg: string;
  durationMs?: number;
  [key: string]: unknown;
}

interface Sink {
  lines: LogLine[];
  write: (chunk: string) => void;
}

/**
 * In-memory pino destination — see {@link tests/logger.test.ts} for
 * rationale.
 * @returns A sink with `lines` and `write`.
 */
function makeSink(): Sink {
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

describe("withTracedOperation", () => {
  it("returns the fn result and emits a paired *.complete log line with durationMs (C4)", async () => {
    const sink = makeSink();
    const logger = createLogger({ service: "felafel-worker" }, sink);

    const result = await withTracedOperation(
      "worker.upsert",
      () => 42,
      logger,
    );

    expect(result).toBe(42);
    const completionLine = sink.lines.find(
      (l) => l.msg === "worker.upsert.complete",
    );
    expect(completionLine).toBeDefined();
    expect(typeof completionLine!.durationMs).toBe("number");
  });
});
