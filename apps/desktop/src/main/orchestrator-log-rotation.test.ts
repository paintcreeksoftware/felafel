// unicorn/prefer-event-target asks for EventTarget over EventEmitter,
// but the production code (orchestrator-log-rotation.ts) wires up Node's
// EventEmitter-shaped `Readable.on("data")` — the test's stubs have to
// match that shape exactly. EventTarget would force a `.dispatchEvent` +
// `addEventListener` rewrite of the production code too.
/* eslint-disable unicorn/prefer-event-target */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pinoRollMock = vi.fn();
vi.mock("pino-roll", () => ({
  default: (opts: unknown) => pinoRollMock(opts),
}));
vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/felafel-test-userdata") },
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(() => Promise.resolve()),
}));

const { teeStderrToRotatedFile } = await import(
  "@felafel/desktop/main/orchestrator-log-rotation"
);

/**
 * Minimal Logger stub — only the `error` method is exercised here.
 * @returns the stub logger.
 */
function makeLogger(): { error: ReturnType<typeof vi.fn> } {
  return { error: vi.fn() };
}

/**
 * Stand-in for the spawned orchestrator's stderr Readable.
 * @returns the EventEmitter the helper subscribes to.
 */
function makeChildStderr(): EventEmitter { return new EventEmitter(); }

/**
 * Stand-in for pino-roll's returned stream. EventEmitter for the
 * helper's `.on("error", ...)` subscription, plus a spy `write` for
 * the per-chunk forwarding assertion.
 * @returns the EventEmitter + write spy.
 */
function makeRollStream(): EventEmitter & { write: ReturnType<typeof vi.fn> } {
  const stream = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
  };
  stream.write = vi.fn();
  return stream;
}

describe("teeStderrToRotatedFile", () => {
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  beforeEach(() => {
    stderrSpy.mockClear();
    pinoRollMock.mockReset();
  });
  afterEach(() => {
    stderrSpy.mockClear();
  });

  it("writes each child-stderr chunk to BOTH process.stderr and the roll stream", async () => {
    const rollStream = makeRollStream();
    pinoRollMock.mockResolvedValue(rollStream);
    const childStderr = makeChildStderr();

    await teeStderrToRotatedFile(childStderr as never, makeLogger() as never);

    const chunkA = Buffer.from("line a\n");
    const chunkB = Buffer.from("line b\n");
    childStderr.emit("data", chunkA);
    childStderr.emit("data", chunkB);

    expect(stderrSpy).toHaveBeenCalledTimes(2);
    expect(stderrSpy).toHaveBeenCalledWith(chunkA);
    expect(stderrSpy).toHaveBeenCalledWith(chunkB);
    expect(rollStream.write).toHaveBeenCalledTimes(2);
    expect(rollStream.write).toHaveBeenCalledWith(chunkA);
    expect(rollStream.write).toHaveBeenCalledWith(chunkB);
  });

  it("logs but never throws when the roll stream emits an error", async () => {
    const rollStream = makeRollStream();
    pinoRollMock.mockResolvedValue(rollStream);
    const logger = makeLogger();

    await teeStderrToRotatedFile(makeChildStderr() as never, logger as never);
    const err = new Error("disk full");
    expect(() => rollStream.emit("error", err)).not.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      { err },
      "orchestrator.log-rotation.stream.failed",
    );
  });
});
