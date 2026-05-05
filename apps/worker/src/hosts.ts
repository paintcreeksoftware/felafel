// Pure host-resolution helper extracted from the entrypoint so the
// precedence rules between WORKER_HOST (advertised) and WORKER_BIND_HOST
// (bound) are unit-testable without spawning the worker process.
import { Defaults } from "@felafel/worker/constants";

/** Resolved bind + advertise hostnames. See {@link resolveHosts}. */
export interface HostResolution {
  /** Hostname embedded in the advertised `controlPlaneUrl`. */
  advertiseHost: string;
  /** Hostname passed to `serve({ hostname })`. */
  bindHost: string;
}

/**
 * Decide which host the worker advertises in its `controlPlaneUrl` and
 * which it actually binds. The two diverge in userspace-mode Tailnet
 * sidecars where the advertised IP is virtual and not bindable on a
 * kernel interface — bind has to be `0.0.0.0`/loopback while the
 * advertised URL points at the Tailnet IP.
 *
 * Precedence:
 * - `advertiseHost` = explicit `WORKER_HOST` → autodetected Tailnet IP →
 *   `Defaults.HOST` (loopback)
 * - `bindHost` = explicit `WORKER_BIND_HOST` → whatever `advertiseHost`
 *   resolved to (back-compat: pre-PAI-107 behavior was bind == advertise)
 *
 * @param opts.explicitAdvertiseHost - value of `WORKER_HOST`, or undefined
 * @param opts.explicitBindHost - value of `WORKER_BIND_HOST`, or undefined
 * @param opts.tailnetIp - result of `tailscale ip -4`, or null when
 *   unavailable. Caller is expected to skip the spawn when
 *   `explicitAdvertiseHost` is set, since the autodetect would be ignored.
 * @returns the resolved `{ advertiseHost, bindHost }` pair
 */
export function resolveHosts(opts: {
  explicitAdvertiseHost: string | undefined;
  explicitBindHost: string | undefined;
  tailnetIp: string | null;
}): HostResolution {
  const advertiseHost =
    opts.explicitAdvertiseHost ?? opts.tailnetIp ?? Defaults.HOST;
  const bindHost = opts.explicitBindHost ?? advertiseHost;
  return { advertiseHost, bindHost };
}
