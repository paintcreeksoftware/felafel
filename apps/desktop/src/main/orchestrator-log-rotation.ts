// File-rotation tee for the orchestrator child's stderr.
//
// In a packaged Electron build there's no terminal, so the orchestrator's
// JSONL log stream needs to land somewhere on disk. This module wires the
// piped stderr to two consumers: the parent process's own stderr (so a
// container or systemd unit can still pick the lines up) and a `pino-roll`
// rotated file at `<userData>/logs/orchestrator.jsonl` (50 MB × up to 5
// files, daily-or-size rotation).
import { mkdir } from "node:fs/promises";
import type { Readable } from "node:stream";
import { app } from "electron";
import pinoRoll from "pino-roll";
import { join } from "pathe";
import type { Logger } from "@felafel/logs";

/** Maximum size per rotated file. `pino-roll` accepts `k`/`m`/`g` suffixes. */
const ROTATION_SIZE = "50M";
/** Maximum rotated files retained alongside the active one. */
const ROTATION_LIMIT_COUNT = 5;
/** Time-based rotation cadence; combines with size — whichever trips first. */
const ROTATION_FREQUENCY = "daily";
/** Sub-directory under Electron's `userData` where the rotated files live. */
const LOGS_SUBDIR = "logs";
/** Base file name; `pino-roll` appends a numeric rotation suffix. */
const LOG_FILE_BASENAME = "orchestrator.jsonl";

/**
 * Wire the child's stderr to the parent's stderr AND a `pino-roll`
 * rotated file under `<userData>/logs/`. Errors on the file stream are
 * logged but never thrown — the orchestrator is already running and the
 * parent's stderr still receives the lines.
 * @param childStderr - the spawned child's stderr Readable (stdio[2]=pipe).
 * @param logger - service-bound logger for rotation-stream failures.
 */
export async function teeStderrToRotatedFile(
  childStderr: Readable,
  logger: Logger,
): Promise<void> {
  const logsDir = join(app.getPath("userData"), LOGS_SUBDIR);
  await mkdir(logsDir, { recursive: true });
  const rollStream = await pinoRoll({
    file: join(logsDir, LOG_FILE_BASENAME),
    size: ROTATION_SIZE,
    frequency: ROTATION_FREQUENCY,
    limit: { count: ROTATION_LIMIT_COUNT },
  });
  rollStream.on("error", (err: Error) => {
    logger.error({ err }, "orchestrator.log-rotation.stream.failed");
  });
  childStderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    rollStream.write(chunk);
  });
}
