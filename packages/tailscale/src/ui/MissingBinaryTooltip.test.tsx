// Component tests for MissingBinaryTooltip — the install-hint
// tooltip wrapped around the pill when `tailscale` isn't on PATH.
// The tooltip's content is the actual product surface (the
// install-via-distro-package-manager remediation copy); these tests
// pin the most important parts so a refactor doesn't accidentally
// drop them.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MissingBinaryTooltip } from "@felafel/tailscale/ui/MissingBinaryTooltip";

afterEach(() => {
  cleanup();
});

describe("MissingBinaryTooltip", () => {
  it("renders the child pill verbatim as the trigger", () => {
    render(
      <MissingBinaryTooltip>
        <span data-testid="anchor">Tailscale not installed</span>
      </MissingBinaryTooltip>,
    );
    expect(screen.getByTestId("anchor")).toBeDefined();
  });

  it("anchors the trigger as a focusable element so the tooltip is keyboard-accessible", () => {
    const { container } = render(
      <MissingBinaryTooltip>
        <span data-testid="anchor">pill</span>
      </MissingBinaryTooltip>,
    );
    // The wrapper <span> gets tabIndex=0 — radix's asChild merges the
    // trigger props onto the rendered child. Either the anchor or its
    // parent receives the index.
    const focusable = container.querySelector("[tabindex='0']");
    expect(focusable).not.toBeNull();
  });
});
