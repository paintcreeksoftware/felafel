import { useEffect, useState } from "react";
import {
  makeClient,
  type OrchestratorStatus,
  type Worker,
} from "@felafel/desktop/orchestrator";
import { TailscalePill } from "@felafel/tailscale/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@felafel/ui/components/ui/alert-dialog";

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

/**
 * Resolve which label to render for the orchestrator state.
 * @param props - orchestrator status props
 * @param props.statusError - error message from the last status probe, or null
 * @param props.status - the current orchestrator lifecycle state
 * @param props.orchUrl - origin (e.g. `http://127.0.0.1:9090`) when ready, else null
 * @returns the label JSX
 */
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
        <span className="font-mono text-sm text-muted-foreground/70">{props.orchUrl}</span>
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
 * @param root0 - props
 * @param root0.status - the worker's liveness status
 * @returns the pill JSX
 */
function StatusPill({ status }: { status: Worker["status"] }) {
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

/**
 * Resolve which list/empty/error view to render for the worker registry.
 * @param props - worker list props
 * @param props.workers - the registered workers, or null while loading
 * @param props.workersError - error message from the last fetch, or null
 * @param props.onForget - callback to drop a stale worker from the registry
 * @returns the list/empty/error JSX
 */
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

/**
 * Top-level renderer component: subscribes to orchestrator status +
 * worker registry IPC channels, slots the Tailscale pill, and
 * renders the three view-pieces (OrchestratorLabel, WorkersList,
 * StatusPill) into the app shell.
 * @returns the renderer root JSX
 */
export default function App() {
  const [status, setStatus] = useState<Status>("unknown");
  const [orchUrl, setOrchUrl] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [tailnetServeDegradation, setTailnetServeDegradation] =
    useState<TailnetServeDegradation | null>(null);
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [workersError, setWorkersError] = useState<string | null>(null);
  // `workerToForget` doubles as the AlertDialog's `open` signal —
  // null = closed; a Worker = open, pinned to that row. Setting it
  // back to null on either Cancel or successful Forget closes the
  // dialog without a separate flag.
  const [workerToForget, setWorkerToForget] = useState<Worker | null>(null);

  /**
   * Issue DELETE /workers/:id for the previously-confirmed worker.
   * 204 is the success path; the next poll cycle (≤5s) drops the row.
   * 409 surfaces the orchestrator's "still has live runs" guard back
   * to the user as an inline error.
   * @param worker - the worker to forget
   */
  async function forgetWorker(worker: Worker): Promise<void> {
    if (!orchUrl) {
      return;
    }
    try {
      const client = makeClient(orchUrl);
      const res = await client.workers[":id"].$delete({
        param: { id: worker.id },
      });
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
      setWorkersError(error instanceof Error ? error.message : String(error));
    }
  }

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
    if (!orchUrl) {return () => { /* no orchestrator URL yet — nothing to clean up */ };}
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
    <div className="
      flex min-h-screen items-center justify-center bg-background font-sans
      text-foreground
    ">
      <header className="absolute top-4 right-4 z-10">
        <TailscalePill tailnetServeDegradation={tailnetServeDegradation} />
      </header>
      <main className="
        flex min-h-screen w-full max-w-3xl flex-col items-center justify-between
        bg-background px-16 py-32
        sm:items-start
      ">
        <img src="./next.svg" alt="Felafel logo" width={100} height={20} className="
          dark:invert
        " />
        <div className="
          flex flex-col items-center gap-6 text-center
          sm:items-start sm:text-left
        ">
          <h1 className="
            max-w-xs text-3xl/10 font-semibold tracking-tight text-foreground
          ">
            To get started, edit src/renderer/src/App.tsx.
          </h1>
          <p className="max-w-md text-lg/8 text-muted-foreground">
            Orchestrator:{" "}
            <OrchestratorLabel statusError={statusError} status={status} orchUrl={orchUrl} />
          </p>
          <section className="w-full max-w-md text-base/7 text-muted-foreground">
            <h2 className="mb-2 text-lg font-medium text-foreground">Workers</h2>
            <WorkersList
              workers={workers}
              workersError={workersError}
              onForget={setWorkerToForget}
            />
          </section>
        </div>
        <div className="
          flex flex-col gap-4 text-base font-medium
          sm:flex-row
        " />
      </main>
      <AlertDialog
        open={workerToForget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setWorkerToForget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forget worker?</AlertDialogTitle>
            <AlertDialogDescription>
              {workerToForget
                ? `"${workerToForget.hostname}" will be permanently removed from the orchestrator's database. The worker daemon can re-register if it heartbeats again.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = workerToForget;
                setWorkerToForget(null);
                if (target) {
                  void forgetWorker(target);
                }
              }}
            >
              Forget
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
