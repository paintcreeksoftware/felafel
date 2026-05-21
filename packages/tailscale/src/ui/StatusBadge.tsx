// Status → Badge JSX mapping for the Tailscale pill. Pure: given the
// daemon status, the local busy state, and any orchestrator-side serve
// degradation, render the right `<Badge>` variant.
//
// Extracted out of Pill.tsx so the parent component stays focused on
// stateful click-flow / modal / IPC wiring. Every visual variant of the
// pill lives here.
import { CircleX, LoaderCircle, WifiHigh, WifiOff } from "lucide-react";
import { type TailscaleStatus } from "@felafel/shared";
import { Badge } from "@felafel/ui/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@felafel/ui/components/ui/tooltip";

/** Local busy state shared between Pill.tsx and StatusBadge. */
export type PillBusy = "connecting" | "refreshing" | null;

/** Orchestrator-side serve degradation surfaced into the pill. */
export interface ServeDegradation {
  reason: string;
  remediation?: string;
}

/** Props for {@link StatusBadge}. Exported so consumers outside this package (e.g. Storybook stories) can name the prop shape. */
export interface StatusBadgeProps {
  status: TailscaleStatus;
  busy: PillBusy;
  serveDegradation: ServeDegradation | null;
}

/**
 * Render the right pill badge for the current Tailscale status + local
 * busy state. Busy state wins over status because a click is the most
 * recent thing the user did and they want visible feedback.
 * @param root0 - props
 * @param root0.status - the discriminated TailscaleStatus from main
 * @param root0.busy - local "connecting"/"refreshing" state, or null
 * @param root0.serveDegradation - orchestrator serve failure, or null
 * @returns the pill JSX
 */
export function StatusBadge({ status, busy, serveDegradation }: StatusBadgeProps) {
  if (busy === "connecting") {
    return (
      <Badge variant="secondary">
        <div className="flex w-fit items-center">
          <LoaderCircle data-icon="inline-start" className="size-5 animate-spin" />
          <div>Connecting…</div>
        </div>
      </Badge>
    );
  }
  if (busy === "refreshing") {
    return (
      <Badge variant="secondary">
        <div className="flex w-fit items-center">
          <LoaderCircle data-icon="inline-start" className="size-5 animate-spin" />
          <div>Refreshing…</div>
        </div>
      </Badge>
    );
  }
  switch (status.kind) {
    case "unknown":
    case "probing": {
      return (
        <Badge variant="secondary">
          <div className="flex w-fit items-center">
            <LoaderCircle data-icon="inline-start" className="size-5 animate-spin" />
            <div>Checking…</div>
          </div>
        </Badge>
      );
    }
    case "connected": {
      // Daemon is up, but if the orchestrator's `tailscale serve` setup
      // failed, the integration isn't actually usable for remote dispatch.
      // Render amber + tooltip with remediation instead of plain green —
      // the green pill alone would be technically accurate for the daemon
      // but misleading about Felafel's working surface.
      if (serveDegradation) {
        return (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="
                    border-amber-600/50 bg-amber-100 text-amber-900
                    dark:border-amber-400/50 dark:bg-amber-950 dark:text-amber-200
                  "
                  data-testid="ts-pill-degraded"
                >
                  <div className="flex w-fit items-center">
                    <WifiHigh data-icon="inline-start" className="mr-1 size-5 pb-1" />
                    <div>{status.tailnet} (serve degraded)</div>
                  </div>
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm space-y-2 text-xs">
                <p>{serveDegradation.reason}</p>
                {serveDegradation.remediation ? (
                  <p>
                    Run: <span className="font-mono">{serveDegradation.remediation}</span>
                  </p>
                ) : null}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      }
      return (
        <Badge
          variant="outline"
          className="
            border-green-600/50 bg-green-100 text-green-900
            dark:border-green-400/50 dark:bg-green-950 dark:text-green-200
          "
          aria-label={`Connected to ${status.tailnet}`}
        >
          <div className="flex w-fit items-center">
            <WifiHigh data-icon="inline-start" className="mr-1 size-5 pb-1" />
            <div>Connected to {status.tailnet}</div>
          </div>
        </Badge>
      );
    }
    case "disconnected": {
      return (
        <Badge variant="outline">
          <div className="flex w-fit items-center">
            <WifiOff data-icon="inline-start" className="mr-1 size-5" />
            <div>
              {status.reason === "no-daemon" ? "Tailscale daemon not running" : "Connect to Tailscale"}
            </div>
          </div>
        </Badge>
      );
    }
    case "error": {
      return (
        <Badge variant="outline" className="border-destructive/40 text-destructive">
          <div className="flex w-fit items-center">
            <CircleX data-icon="inline-start" className="mr-1 size-5" />
            <div>Tailscale error</div>
          </div>
        </Badge>
      );
    }
    case "missing-binary": {
      return (
        <Badge variant="outline" className="opacity-60">
          <div className="flex w-fit items-center">
            <WifiOff data-icon="inline-start" className="mr-1 size-5" />
            <div>Tailscale not installed</div>
          </div>
        </Badge>
      );
    }
    // Exhaustive over TailscaleStatus discriminated union; TS catches a missed case at compile time.
    // no default
  }
}
