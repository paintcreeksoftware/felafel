// Ambient module declaration for `pino-roll`. The upstream package
// ships no `.d.ts`; this minimal shim describes only the entry shape
// we use (programmatic invocation, returning a writable stream).
//
// The returned value is a `SonicBoom` instance, but `sonic-boom` is a
// transitive of `pino-roll` and isn't listed in this package's
// dependencies — importing the `SonicBoom` type here would be a
// phantom-dep. Instead we describe the stream structurally: the
// orchestrator-log-rotation consumer only uses `.write()` and `.on()`,
// so a `Pick<NodeJS.WritableStream, ...>` covers it without crossing a
// package boundary. Widen if a new method gets called.
declare module "pino-roll" {
  /** Options accepted by the in-process `pinoRoll()` call. */
  interface PinoRollOptions {
    /** Absolute or relative path to the rotated log file. */
    file: string;
    /** Per-file size cap; accepts `k`/`m`/`g` suffixes. */
    size?: string;
    /** Time-based rotation cadence — `daily`/`hourly`/`weekly` or ms. */
    frequency?: string | number;
    /** Retention knobs; `count` keeps N rotated files alongside the active one. */
    limit?: { count: number };
  }

  /**
   * Structural subset of the SonicBoom stream returned by `pinoRoll()`.
   * Only the methods the desktop consumer actually calls — adding a new
   * call site means widening this Pick, not importing SonicBoom.
   */
  type PinoRollStream = Pick<NodeJS.WritableStream, "write" | "on">;

  /**
   * Build a rotating writable stream by size and/or time as configured.
   * @param opts - rotation knobs; see {@link PinoRollOptions}
   * @returns a writable stream that the caller pipes log lines into
   */
  export default function pinoRoll(opts: PinoRollOptions): Promise<PinoRollStream>;
}
