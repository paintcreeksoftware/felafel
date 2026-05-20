// Type augmentation for `window.api` so any story that imports a
// renderer component using `window.api` (e.g. TailscalePill) typechecks
// inside this workspace's compilation. Mirrors the same pattern used in
// `apps/desktop/src/renderer/src/orchestrator.ts` and
// `packages/tailscale/src/ui/window.d.ts` — the runtime implementation
// is stubbed per-story via Storybook decorators.
import { type DesktopApi } from "@felafel/shared";

declare global {
  interface Window {
    api: DesktopApi;
  }
}
