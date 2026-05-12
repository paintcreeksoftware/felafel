import { useEffect, useState } from "react";
import {
  makeClient,
  type OrchestratorStatus,
  type Worker,
} from "@felafel/desktop/orchestrator";
import { TailscalePill } from "@felafel/tailscale/ui";

type Status = OrchestratorStatus["kind"] | "unknown";

/**
 * Cadence for re-polling `GET /workers`. The orchestrator's heartbeat sweep
 * runs every 30s (apps/orchestrator/src/index.ts), so 5s on the renderer
 * side picks up newly-registered workers and stale-flag transitions
 * promptly without flooding the loopback HTTP path.
 */
const WORKERS_POLL_MS = 5_000;

/** HTTP status literals used in the Worker forget flow. */
const STATUS_NO_CONTENT = 204;
const STATUS_CONFLICT = 409;

/** Degradation shape from `OrchestratorStatus.ready.degradations.tailnetServe`. */
interface TailnetServeDegradation {
  reason: string;
  remediation?: string;
}

/** Resolve which label to render for the orchestrator state. */
function OrchestratorLabel(props: {
  statusError: string | null;
  status: Status;
  orchUrl: string | null;
}) {
  if (props.statusError) {
    return <span className="text-destructive">{props.statusError}</span>;
  }
  if (props.status === "ready" && props.orchUrl) {
    return (
      <span>
        <span className="font-mono">ready</span>{" "}
        <span className="text-muted-foreground/70 font-mono text-sm">{props.orchUrl}</span>
      </span>
    );
  }
  if (props.status === "starting") {
    return <span>starting...</span>;
  }
  // No `status === "error"` branch: the IPC handler sets statusError
  // alongside status, so the statusError check above always fires first
  // when status is "error". Leaving an unreachable branch here would be
  // a bug magnet for anyone refactoring the prop contract later.
  return <span>connecting...</span>;
}

/**
 * Inline pill rendering a worker's liveness status. `active` is green —
 * worker is heartbeating; the orchestrator can dispatch to it. `stale`
 * is amber — worker stopped heartbeating past the sweep threshold; the
 * row is still in the DB but the worker is presumed gone.
 */
function StatusPill({ status }: { status: Worker["status"] }) {
  const color =
    status === "active"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs font-medium ${color}`}
    >
      {status}
    </span>
  );
}

/** Resolve which list/empty/error view to render for the worker registry. */
function WorkersList(props: {
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
          <span className="text-muted-foreground/70 font-mono text-xs">({w.id})</span>
          {w.status === "stale" && (
            <button
              type="button"
              onClick={() => {
                props.onForget(w);
              }}
              className="text-muted-foreground hover:text-foreground ml-auto text-xs underline underline-offset-2"
            >
              forget
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [status, setStatus] = useState<Status>("unknown");
  const [orchUrl, setOrchUrl] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [tailnetServeDegradation, setTailnetServeDegradation] =
    useState<TailnetServeDegradation | null>(null);
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [workersError, setWorkersError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = window.api.onOrchestratorStatus((next) => {
      setStatus(next.kind);
      if (next.kind === "ready") {
        setOrchUrl(next.url);
        setStatusError(null);
        setTailnetServeDegradation(next.degradations?.tailnetServe ?? null);
      } else if (next.kind === "error") {
        setStatusError(next.message);
      }
    });
    // Recover the latest cached status so an "error" or "ready" broadcast
    // that fired before the window mounted still lands in our state. Live
    // updates after this point arrive via the subscription above.
    void (async () => {
      const cached = await window.api.orchestratorStatus();
      setStatus(cached.kind);
      if (cached.kind === "ready") {
        setOrchUrl(cached.url);
        setTailnetServeDegradation(cached.degradations?.tailnetServe ?? null);
      } else if (cached.kind === "error") {
        setStatusError(cached.message);
      }
    })();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!orchUrl) {return () => {};}
    const client = makeClient(orchUrl);
    let cancelled = false;
    const fetchWorkers = async () => {
      try {
        const res = await client.workers.$get();
        if (!res.ok) {throw new Error(`GET /workers ${res.status}`);}
        const next = (await res.json()) as Worker[];
        // Drop the result if the effect was torn down (orchUrl changed or
        // unmount) while the request was in flight — otherwise the late
        // resolve would clobber state owned by the next effect run.
        if (cancelled) {return;}
        setWorkers(next);
        setWorkersError(null);
      } catch (error) {
        if (cancelled) {return;}
        setWorkersError(error instanceof Error ? error.message : String(error));
      }
    };
    void fetchWorkers();
    const interval = setInterval(() => {
      void fetchWorkers();
    }, WORKERS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orchUrl]);

  return (
    <div className="bg-background text-foreground flex min-h-screen items-center justify-center font-sans">
      <header className="absolute right-4 top-4 z-10">
        <TailscalePill tailnetServeDegradation={tailnetServeDegradation} />
      </header>
      <main className="bg-background flex min-h-screen w-full max-w-3xl flex-col items-center justify-between px-16 py-32 sm:items-start">
        <img src="./next.svg" alt="Felafel logo" width={100} height={20} className="dark:invert" />
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="text-foreground max-w-xs text-3xl font-semibold leading-10 tracking-tight">
            To get started, edit src/renderer/src/App.tsx.
          </h1>
          <p className="text-muted-foreground max-w-md text-lg leading-8">
            Orchestrator:{" "}
            <OrchestratorLabel statusError={statusError} status={status} orchUrl={orchUrl} />
          </p>
          <section className="text-muted-foreground w-full max-w-md text-base leading-7">
            <h2 className="text-foreground mb-2 text-lg font-medium">Workers</h2>
            <WorkersList
              workers={workers}
              workersError={workersError}
              onForget={(worker) => {
                if (!orchUrl) {
                  return;
                }
                const confirmed = window.confirm(
                  `Forget worker "${worker.hostname}"? This permanently removes the row from the orchestrator's database.`,
                );
                if (!confirmed) {
                  return;
                }
                void (async () => {
                  try {
                    const client = makeClient(orchUrl);
                    const res = await client.workers[":id"].$delete({
                      param: { id: worker.id },
                    });
                    // 204 = forget succeeded; the next poll cycle (≤5s)
                    // will drop the row from the rendered list.
                    if (res.status === STATUS_NO_CONTENT) {
                      setWorkersError(null);
                      return;
                    }
                    if (res.status === STATUS_CONFLICT) {
                      const body = (await res.json()) as { message: string };
                      setWorkersError(body.message);
                      return;
                    }
                    setWorkersError(`DELETE /workers ${res.status.toString()}`);
                  } catch (error) {
                    setWorkersError(
                      error instanceof Error ? error.message : String(error),
                    );
                  }
                })();
              }}
            />
          </section>
        </div>
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row" />
      </main>
    </div>
  );
}
