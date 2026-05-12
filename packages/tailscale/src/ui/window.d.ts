// Type augmentation for `window.api` so the Pill typechecks inside this
// package's isolated build. The renderer at apps/desktop wires the real
// implementation via preload + contextBridge and declares the same global
// in its own scope; the declarations are structurally identical and TS
// merges them at the renderer's compile point.
import { type DesktopApi } from "@felafel/shared";

declare global {
  interface Window {
    api: DesktopApi;
  }
}
