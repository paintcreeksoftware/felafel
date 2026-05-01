import { useEffect, useState } from "react";
import {
  makeClient,
  type OrchestratorStatus,
  type Worker,
} from "@felafel/desktop/orchestrator";
import { TailscalePill } from "@felafel/desktop/components/TailscalePill";

type Status = OrchestratorStatus["kind"] | "unknown";

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
  if (props.status === "error") {
    return <span className="text-destructive">error</span>;
  }
  return <span>connecting...</span>;
}

/** Resolve which list/empty/error view to render for the worker registry. */
function WorkersList(props: { workers: Worker[] | null; workersError: string | null }) {
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
    <ul className="space-y-1">
      {props.workers.map((w) => (
        <li key={w.id} className="font-mono text-sm">
          {w.hostname} <span className="text-muted-foreground/70">({w.id})</span>
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [status, setStatus] = useState<Status>("unknown");
  const [orchUrl, setOrchUrl] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [workersError, setWorkersError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = window.api.onOrchestratorStatus((next) => {
      setStatus(next.kind);
      if (next.kind === "ready") {
        setOrchUrl(next.url);
        setStatusError(null);
      } else if (next.kind === "error") {
        setStatusError(next.message);
      }
    });
    void (async () => {
      const url = await window.api.orchestratorUrl();
      if (url) {
        setStatus("ready");
        setOrchUrl(url);
      }
    })();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!orchUrl) {return;}
    const client = makeClient(orchUrl);
    void (async () => {
      try {
        const res = await client.workers.$get();
        if (!res.ok) {throw new Error(`GET /workers ${res.status}`);}
        setWorkers((await res.json()) as Worker[]);
        setWorkersError(null);
      } catch (error) {
        setWorkersError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [orchUrl]);

  return (
    <div className="bg-background text-foreground flex min-h-screen items-center justify-center font-sans">
      <header className="absolute right-4 top-4 z-10">
        <TailscalePill />
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
            <WorkersList workers={workers} workersError={workersError} />
          </section>
        </div>
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row" />
      </main>
    </div>
  );
}
