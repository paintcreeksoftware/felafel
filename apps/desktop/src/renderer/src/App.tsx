import { useEffect, useState } from "react";
import { makeClient, type OrchestratorStatus, type Worker } from "./orchestrator";
import { TailscalePill } from "./components/TailscalePill";

type Status = OrchestratorStatus["kind"] | "unknown";

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
    void window.api.orchestratorUrl().then((url) => {
      if (url) {
        setStatus("ready");
        setOrchUrl(url);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!orchUrl) return;
    const client = makeClient(orchUrl);
    void (async () => {
      try {
        const res = await client.workers.$get();
        if (!res.ok) throw new Error(`GET /workers ${res.status}`);
        setWorkers((await res.json()) as Worker[]);
        setWorkersError(null);
      } catch (err) {
        setWorkersError(err instanceof Error ? err.message : String(err));
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
            {statusError ? (
              <span className="text-destructive">{statusError}</span>
            ) : status === "ready" && orchUrl ? (
              <span>
                <span className="font-mono">ready</span>{" "}
                <span className="text-muted-foreground/70 font-mono text-sm">{orchUrl}</span>
              </span>
            ) : status === "starting" ? (
              <span>starting...</span>
            ) : status === "error" ? (
              <span className="text-destructive">error</span>
            ) : (
              <span>connecting...</span>
            )}
          </p>
          <section className="text-muted-foreground w-full max-w-md text-base leading-7">
            <h2 className="text-foreground mb-2 text-lg font-medium">Workers</h2>
            {workersError ? (
              <p className="text-destructive">{workersError}</p>
            ) : workers === null ? (
              <p>loading...</p>
            ) : workers.length === 0 ? (
              <p>No workers registered yet.</p>
            ) : (
              <ul className="space-y-1">
                {workers.map((w) => (
                  <li key={w.id} className="font-mono text-sm">
                    {w.hostname} <span className="text-muted-foreground/70">({w.id})</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row" />
      </main>
    </div>
  );
}
