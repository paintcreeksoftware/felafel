import { hostname } from "node:os";

import { describe, expect, it } from "vitest";

import { createLogger } from "@felafel/logs";

interface LogLine {
  service: string;
  node: string;
  msg: string;
  [key: string]: unknown;
}

interface Sink {
  lines: LogLine[];
  write: (chunk: string) => void;
}

/**
 * Build a pino-compatible destination stream that collects emitted JSON
 * lines into an in-memory array, so tests can assert on log shape
 * without touching stderr or the filesystem.
 * @returns A {@link Sink} with a `lines` array and a `write` method.
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

describe("createLogger", () => {
  it("emits log lines with the `service` binding", () => {
    const sink = makeSink();
    const logger = createLogger({ service: "felafel-worker" }, sink);

    logger.info("hello");

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]!.service).toBe("felafel-worker");
    expect(sink.lines[0]!.msg).toBe("hello");
  });

  it("defaults `node` to os.hostname()", () => {
    const sink = makeSink();
    const logger = createLogger({ service: "felafel-worker" }, sink);

    logger.info("hi");

    expect(sink.lines[0]!.node).toBe(hostname());
  });

  it("uses an explicit `node` binding when provided", () => {
    const sink = makeSink();
    const logger = createLogger(
      { service: "felafel-worker", node: "homelab-1" },
      sink,
    );

    logger.info("hi");

    expect(sink.lines[0]!.node).toBe("homelab-1");
  });
});
