// Tailscale connection pill — shows whether the host is on a tailnet, and
// surfaces a paste-in flow for a pre-auth key when not. Driven entirely by
// the TailscaleStatus discriminated union pushed from main; click handler
// triggers the session-resume → paste-in fallback documented in tailscale.ts.
//
// Pill placement is meant to be top-right of the app shell; App.tsx slots
// it into a positioned container.
import { useEffect, useRef, useState } from "react";
import { CircleX, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { type TailscaleStatus } from "@felafel/shared";
import { MissingBinaryTooltip } from "@felafel/tailscale/ui/MissingBinaryTooltip";
import { StatusBadge, type PillBusy, type ServeDegradation } from "@felafel/tailscale/ui/StatusBadge";
import { Alert, AlertDescription, AlertTitle } from "@felafel/ui/components/ui/alert";
import { Button } from "@felafel/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@felafel/ui/components/ui/dialog";
import { Input } from "@felafel/ui/components/ui/input";
import { Label } from "@felafel/ui/components/ui/label";

interface SubmitError {
  message: string;
  remediation?: string;
}

/**
 * Optional orchestrator-side tailnet-serve degradation. When the
 * Tailscale daemon is connected (so the pill would normally render
 * green) but Felafel's orchestrator failed to publish via
 * `tailscale serve`, the pill flips to amber + a tooltip showing
 * the remediation. Surfacing it here instead of as a separate badge
 * because for a Felafel user the meaningful question is "is the
 * Tailscale integration usable for dispatch?" — a green pill plus
 * a separate "degraded" badge splits one answer across two surfaces.
 */
interface TailscalePillProps {
  tailnetServeDegradation?: ServeDegradation | null;
}

const ADMIN_KEYS_URL = "https://login.tailscale.com/admin/settings/keys";

/**
 * Floor on how long the pill's busy spinner stays visible. The connect
 * + refresh IPC round-trips can finish in tens of milliseconds on the
 * happy path, which leaves the user with a flicker instead of clear
 * feedback that the click registered. Held for 500 ms — eye-tracking
 * literature's lower bound for "the user noticed motion." Real work
 * that exceeds the floor (e.g. the orchestrator serve re-attempt from
 * PAI-138's refresh path) tracks reality once it's perceptible.
 */
const MIN_VISIBLE_BUSY_MS = 500;

/**
 * Hold the resolved value of `work` until at least
 * {@link MIN_VISIBLE_BUSY_MS} has elapsed. Use to wrap an IPC call whose
 * `pillBusy` state would otherwise flicker too fast to read.
 *
 * @param work - the promise whose result should be returned
 * @returns the resolved value of `work`, never sooner than the floor
 */
async function withMinVisibleBusy<T>(work: Promise<T>): Promise<T> {
  const [result] = await Promise.all([
    work,
    new Promise((resolve) => {
      setTimeout(resolve, MIN_VISIBLE_BUSY_MS);
    }),
  ]);
  return result;
}

export function TailscalePill({ tailnetServeDegradation = null }: TailscalePillProps = {}) {
  const [status, setStatus] = useState<TailscaleStatus>({ kind: "unknown" });
  const [open, setOpen] = useState(false);
  const [authkey, setAuthkey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  // Local "connecting" state distinct from `submitting` — the click flow
  // sometimes runs entirely outside the modal (initial session-resume), and
  // we want pill-level spinner feedback for that case.
  const [pillBusy, setPillBusy] = useState<PillBusy>(null);
  // Keep a ref to the latest `submitting` state so the pill-click /
  // refresh handlers can read it without taking it as a dep (which
  // would re-create the closures on every keystroke into the auth-key
  // input). The sync runs post-commit via useEffect — mutating during
  // render is the anti-pattern react-hooks/refs catches.
  const submittingRef = useRef(submitting);
  useEffect(() => {
    submittingRef.current = submitting;
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await window.api.tailscaleStatus();
      if (!cancelled) {setStatus(s);}
    })();
    const unsubscribe = window.api.onTailscaleStatus((s) => {
      setStatus(s);
      // If a push reports we're connected, close the modal and reset the
      // form — the user's key just worked.
      if (s.kind === "connected") {
        setOpen(false);
        setAuthkey("");
        setSubmitError(null);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function handlePillClick() {
    if (status.kind === "missing-binary") {return;}
    if (pillBusy || submittingRef.current) {return;}
    setPillBusy("connecting");
    setSubmitError(null);
    try {
      const result = await withMinVisibleBusy(window.api.tailscaleConnect());
      if (result.ok) {
        // Success — pill will turn green via the broadcast push. Modal stays
        // closed.
        return;
      }
      if (result.kind === "needs-key") {
        setOpen(true);
        return;
      }
      setSubmitError({ message: result.message, remediation: result.remediation });
    } finally {
      setPillBusy(null);
    }
  }

  async function handleRefresh() {
    if (pillBusy || submittingRef.current) {return;}
    setPillBusy("refreshing");
    setSubmitError(null);
    try {
      const next = await withMinVisibleBusy(window.api.tailscaleRefresh());
      setStatus(next);
    } finally {
      setPillBusy(null);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !authkey.trim()) {return;}
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await window.api.tailscaleConnect(authkey.trim());
      if (result.ok) {
        // The status push from main will close the modal and clear state via
        // the effect above. But also handle it locally in case the push is
        // delayed.
        setOpen(false);
        setAuthkey("");
        return;
      }
      if (result.kind === "needs-key") {
        setSubmitError({
          message: "Session resume failed again. Pasting the key didn't take — try a fresh one.",
        });
        return;
      }
      setSubmitError({ message: result.message, remediation: result.remediation });
    } finally {
      setSubmitting(false);
    }
  }

  const pill = (
    <StatusBadge status={status} busy={pillBusy} serveDegradation={tailnetServeDegradation} />
  );
  const wrappedPill =
    status.kind === "missing-binary" ? <MissingBinaryTooltip>{pill}</MissingBinaryTooltip> : pill;
  const isClickable =
    status.kind !== "missing-binary" && status.kind !== "connected" && !pillBusy;

  return (
    <div className="flex items-center gap-2 p-2" data-testid="ts-pill">
      {isClickable ? (
        <button
          type="button"
          onClick={handlePillClick}
          className="cursor-pointer focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 rounded-full"
          aria-label="Connect to Tailscale"
        >
          {wrappedPill}
        </button>
      ) : (
        wrappedPill
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleRefresh}
        disabled={pillBusy !== null || status.kind === "missing-binary"}
        aria-label="Refresh Tailscale status"
        className="size-7"
      >
        <RefreshCw
          className={pillBusy === "refreshing" ? "size-3.5 animate-spin" : "size-3.5"}
        />
      </Button>

      {submitError && !open ? (
        <Alert variant="destructive" className="max-w-sm">
          <CircleX />
          <AlertTitle>Tailscale error</AlertTitle>
          <AlertDescription>
            <p>{submitError.message}</p>
            {submitError.remediation ? (
              <p className="font-mono text-xs">{submitError.remediation}</p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Connect to Tailscale</DialogTitle>
              <DialogDescription>
                Paste a pre-auth key to register this machine with your tailnet. Generate one on
                the admin console — keys look like <code>tskey-auth-...</code>.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-4">
              <Label htmlFor="ts-authkey">Pre-auth key</Label>
              <Input
                id="ts-authkey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="tskey-auth-..."
                value={authkey}
                onChange={(e) => setAuthkey(e.target.value)}
                disabled={submitting}
              />
              <a
                href={ADMIN_KEYS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
              >
                Open admin keys page <ExternalLink className="size-3" />
              </a>
              {submitError ? (
                <Alert variant="destructive">
                  <CircleX />
                  <AlertTitle>{submitError.remediation ? "Action required" : "Connection failed"}</AlertTitle>
                  <AlertDescription>
                    <p>{submitError.message}</p>
                    {submitError.remediation ? (
                      <p className="font-mono text-xs">{submitError.remediation}</p>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !authkey.trim()}>
                {submitting ? <LoaderCircle className="animate-spin" /> : null}
                {submitting ? "Connecting…" : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

