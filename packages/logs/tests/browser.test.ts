import { describe, expect, it } from "vitest";

import { createLogger } from "@felafel/logs/browser";

interface LogLine {
  service: string;
  node: string;
  version?: string;
  msg: string;
  [key: string]: unknown;
}

interface Sink {
  lines: LogLine[];
  write: (chunk: string) => void;
}

/**
 * In-memory pino destination for Node test runs.
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

describe("createLogger (browser)", () => {
  it("emits records with service + node bindings (node defaults to 'renderer')", () => {
    const sink = makeSink();
    const logger = createLogger(
      { service: "felafel-desktop-renderer" },
      sink,
    );

    logger.info("hello");

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]!.service).toBe("felafel-desktop-renderer");
    expect(sink.lines[0]!.node).toBe("renderer");
    expect(sink.lines[0]!.msg).toBe("hello");
  });
});
