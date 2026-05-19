// Ambient module declaration for `pino-roll`. The upstream package
// ships no `.d.ts`; this minimal shim describes only the entry shape
// we use (programmatic invocation, returning a SonicBoom-compatible
// writable). Keep narrow — if a new pino-roll option gets used here,
// add it explicitly rather than widening to `Record<string, unknown>`.
declare module "pino-roll" {
  import type SonicBoom from "sonic-boom";

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
   * Build a SonicBoom-compatible writable stream that rotates by size
   * and/or time as configured.
   * @param opts - rotation knobs; see {@link PinoRollOptions}
   * @returns a writable stream that the caller pipes log lines into
   */
  export default function pinoRoll(opts: PinoRollOptions): Promise<SonicBoom>;
}
