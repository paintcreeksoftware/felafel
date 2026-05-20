// Worker liveness indicator. Two visual states: active (green) and
// stale (amber). Extracted out of App.tsx so the renderer root stays
// focused on IPC + state, and the pill has its own Storybook surface
// (PAI-190).
import { type Worker } from "@felafel/desktop/orchestrator";

/**
 * Inline pill rendering a worker's liveness status. `active` is green —
 * worker is heartbeating; the orchestrator can dispatch to it. `stale`
 * is amber — worker stopped heartbeating past the sweep threshold; the
 * row is still in the DB but the worker is presumed gone.
 * @param root0 - props
 * @param root0.status - the worker's liveness status
 * @returns the pill JSX
 */
export function StatusPill({ status }: { status: Worker["status"] }) {
  const color =
    status === "active"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return (
    <span
      className={`
        inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs
        font-medium
        ${color}
      `}
    >
      {status}
    </span>
  );
}
