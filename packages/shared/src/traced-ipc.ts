// IPC wrappers that inject + extract W3C traceparent across the
// Electron main ↔ renderer boundary and emit a paired ipc.complete
// log line on every handler completion (PAI-168 C5). The lint rule
// banning bare ipcMain/ipcRenderer outside this file carves out this
// path. ChannelName is sourced from the Channels const so a
// string-literal channel name is a compile error.
import { performance } from "node:perf_hooks";

import { context, propagation, trace } from "@opentelemetry/api";
import {
  ipcMain,
  ipcRenderer,
  type IpcMainInvokeEvent,
} from "electron";

import type { Logger } from "@felafel/logs";

import { Channels } from "@felafel/shared";

const TRACER_NAME = "@felafel/shared/traced-ipc";

type ChannelName = (typeof Channels)[keyof typeof Channels];
type TraceCarrier = { traceparent?: string };

/**
 * Wrap `ipcMain.handle` with W3C `traceparent` extraction + a paired
 * `ipc.complete` log line. The handler signature mirrors Electron's:
 * `(event, ...args)`. The last positional arg passed by `tracedInvoke`
 * is a `TraceCarrier` object — `tracedHandle` strips it before calling
 * the user handler, so handlers never see it.
 * @param channel - a registered key from `Channels`.
 * @param logger - service-bound logger for the `ipc.complete` line.
 * @param handler - the user handler; receives `(event, ...userArgs)`.
 */
export function tracedHandle<C extends ChannelName, R>(
  channel: C,
  logger: Logger,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => R | Promise<R>,
): void {
  const tracer = trace.getTracer(TRACER_NAME);
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...rawArgs: unknown[]) => {
    const last = rawArgs.at(-1);
    const carrier =
      last && typeof last === "object" && "traceparent" in last
        ? (last as TraceCarrier)
        : undefined;
    const userArgs = carrier ? rawArgs.slice(0, -1) : rawArgs;
    const parentCtx = carrier
      ? propagation.extract(context.active(), carrier)
      : context.active();
    return tracer.startActiveSpan(
      `ipc.${channel}`,
      {},
      parentCtx,
      async (span) => {
        const start = performance.now();
        try {
          return await handler(event, ...userArgs);
        } finally {
          const durationMs = Math.round(performance.now() - start);
          span.end();
          logger.info({ channel, durationMs }, "ipc.complete");
        }
      },
    );
  });
}

/**
 * Wrap `ipcRenderer.invoke` with W3C `traceparent` injection. Appends
 * a `TraceCarrier` object as the final positional arg so `tracedHandle`
 * can extract it.
 * @param channel - a registered key from `Channels`.
 * @param args - the user args, passed through to the handler.
 * @returns the handler's resolved value.
 */
export async function tracedInvoke<C extends ChannelName, R = unknown>(
  channel: C,
  ...args: unknown[]
): Promise<R> {
  const carrier: TraceCarrier = {};
  propagation.inject(context.active(), carrier);
  return ipcRenderer.invoke(channel, ...args, carrier) as Promise<R>;
}
