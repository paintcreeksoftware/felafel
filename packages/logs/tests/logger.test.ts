import { hostname } from "node:os";

import { describe, expect, it } from "vitest";

import { createLogger } from "@felafel/logs";

interface LogLine {
  service: string;
  node: string;
  pid: number;
  version?: string;
  time: number;
  level: number;
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

  it("emits `pid`, `time`, and `level` on every line", () => {
    const sink = makeSink();
    const logger = createLogger({ service: "felafel-worker" }, sink);

    logger.info("hi");

    expect(sink.lines[0]!.pid).toBe(process.pid);
    expect(typeof sink.lines[0]!.time).toBe("number");
    expect(sink.lines[0]!.level).toBe(30);
  });

  it("uses an explicit `version` binding when provided", () => {
    const sink = makeSink();
    const logger = createLogger(
      { service: "felafel-worker", version: "1.2.3" },
      sink,
    );

    logger.info("hi");

    expect(sink.lines[0]!.version).toBe("1.2.3");
  });
});
