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

interface StatusBadgeProps {
  status: TailscaleStatus;
  busy: PillBusy;
  serveDegradation: ServeDegradation | null;
}

/**
 * Render the right pill badge for the current Tailscale status + local
 * busy state. Busy state wins over status because a click is the most
 * recent thing the user did and they want visible feedback.
 *
 * @param props.status - the discriminated TailscaleStatus from main
 * @param props.busy - local "connecting"/"refreshing" state, or null
 * @param props.serveDegradation - orchestrator serve failure, or null
 * @returns the pill JSX
 */
export function StatusBadge({ status, busy, serveDegradation }: StatusBadgeProps) {
  if (busy === "connecting") {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <LoaderCircle className="size-3 animate-spin" /> Connecting…
      </Badge>
    );
  }
  if (busy === "refreshing") {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <LoaderCircle className="size-3 animate-spin" /> Refreshing…
      </Badge>
    );
  }
  switch (status.kind) {
    case "unknown":
    case "probing": {
      return (
        <Badge variant="secondary" className="gap-1.5">
          <LoaderCircle className="size-3 animate-spin" /> Checking…
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
                  variant="default"
                  className="
                    gap-1.5 border-amber-500/40 bg-amber-500/15 text-amber-700
                    hover:bg-amber-500/15
                    dark:text-amber-300
                  "
                  data-testid="ts-pill-degraded"
                >
                  <WifiHigh className="size-3" /> {status.tailnet} (serve degraded)
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
          variant="default"
          className="
            gap-1.5 border-green-500/30 bg-green-500/15 text-green-700
            hover:bg-green-500/15
            dark:text-green-300
          "
        >
          <WifiHigh className="size-3" /> Connected to {status.tailnet}
        </Badge>
      );
    }
    case "disconnected": {
      return (
        <Badge variant="outline" className="gap-1.5">
          <WifiOff className="size-3" />
          {status.reason === "no-daemon" ? "Tailscale daemon not running" : "Connect to Tailscale"}
        </Badge>
      );
    }
    case "error": {
      return (
        <Badge variant="outline" className="
          gap-1.5 border-destructive/40 text-destructive
        ">
          <CircleX className="size-3" /> Tailscale error
        </Badge>
      );
    }
    case "missing-binary": {
      return (
        <Badge variant="outline" className="gap-1.5 opacity-60">
          <WifiOff className="size-3" /> Tailscale not installed
        </Badge>
      );
    }
    // Exhaustive over TailscaleStatus discriminated union; TS catches a missed case at compile time.
    // no default
  }
}
