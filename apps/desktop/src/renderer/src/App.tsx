// Top-level UI component. Edit this file to start building the app — it's
// what the "To get started, edit src/renderer/src/App.tsx" line points at.
//
// Pattern: useEffect calls `ensurePocketBase()` once on mount. That async
// flow asks main (via IPC) for the PocketBase URL and superuser credentials,
// then runs `authWithPassword` against the embedded server. When it
// resolves, we render the URL and the signed-in email.
import { useEffect, useState } from "react";
import { pb, ensurePocketBase } from "./pb";
import { TailscalePill } from "./components/TailscalePill";

export default function App() {
  const [pbUrl, setPbUrl] = useState<string | null>(null);
  const [pbEmail, setPbEmail] = useState<string | null>(null);
  const [pbError, setPbError] = useState<string | null>(null);

  useEffect(() => {
    ensurePocketBase()
      .then(() => {
        if (pb.baseURL) {
          setPbUrl(pb.baseURL);
        } else {
          setPbError("Main process never reported a PocketBase URL — check terminal logs.");
          return;
        }
        const record = pb.authStore.record;
        const email = typeof record?.email === "string" ? record.email : null;
        setPbEmail(email);
      })
      .catch((err) => setPbError(err instanceof Error ? err.message : String(err)));
  }, []);

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
            PocketBase status:{" "}
            {pbError ? (
              <span className="text-destructive">{pbError}</span>
            ) : pbUrl ? (
              <span className="font-mono">{pbUrl}</span>
            ) : (
              <span>connecting...</span>
            )}
          </p>
          {pbEmail ? (
            <p className="text-muted-foreground max-w-md text-base leading-7">
              Signed in as <span className="font-mono">{pbEmail}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row" />
      </main>
    </div>
  );
}
