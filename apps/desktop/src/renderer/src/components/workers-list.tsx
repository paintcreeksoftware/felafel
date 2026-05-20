// Worker-registry view: loading / error / empty / populated states +
// the per-row "forget" affordance for stale workers. Extracted out of
// App.tsx for the PAI-190 Storybook surface.
import { StatusPill } from "@felafel/desktop/components/status-pill";
import { type Worker } from "@felafel/desktop/orchestrator";

/**
 * Resolve which list/empty/error view to render for the worker registry.
 * @param props - worker list props
 * @param props.workers - the registered workers, or null while loading
 * @param props.workersError - error message from the last fetch, or null
 * @param props.onForget - callback to drop a stale worker from the registry
 * @returns the list/empty/error JSX
 */
export function WorkersList(props: {
  workers: Worker[] | null;
  workersError: string | null;
  onForget: (worker: Worker) => void;
}) {
  if (props.workersError) {
    return <p className="text-destructive">{props.workersError}</p>;
  }
  if (props.workers === null) {
    return <p>loading...</p>;
  }
  if (props.workers.length === 0) {
    return <p>No workers registered yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {props.workers.map((w) => (
        <li key={w.id} className="flex items-center gap-2 text-sm">
          <StatusPill status={w.status} />
          <span className="font-mono">{w.hostname}</span>
          <span className="font-mono text-xs text-muted-foreground/70">({w.id})</span>
          {w.status === "stale" && (
            <button
              type="button"
              onClick={() => {
                props.onForget(w);
              }}
              className="
                ml-auto text-xs text-muted-foreground underline
                underline-offset-2
                hover:text-foreground
              "
            >
              forget
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
