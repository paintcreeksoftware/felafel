// Renderer-side label for the orchestrator's lifecycle state. Extracted
// out of App.tsx so the renderer root can stay focused on IPC wiring
// and the label has its own Storybook surface (PAI-190).
import { type OrchestratorStatus } from "@felafel/desktop/orchestrator";

/** Lifecycle state the label renders against. */
export type Status = OrchestratorStatus["kind"] | "unknown";

interface OrchestratorLabelProps {
  statusError: string | null;
  status: Status;
  orchUrl: string | null;
}

/**
 * Resolve which label to render for the orchestrator state.
 * @param props - orchestrator status props
 * @param props.statusError - error message from the last status probe, or null
 * @param props.status - the current orchestrator lifecycle state
 * @param props.orchUrl - origin (e.g. `http://127.0.0.1:9090`) when ready, else null
 * @returns the label JSX
 */
export function OrchestratorLabel(props: OrchestratorLabelProps) {
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
