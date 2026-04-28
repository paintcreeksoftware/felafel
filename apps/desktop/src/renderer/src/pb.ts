// PocketBase client singleton for the renderer. One instance shared across
// all components — call `await ensurePocketBase()` from anywhere that needs
// to make sure auth is set up first; the rest of the app just uses `pb`
// directly.
//
// `autoCancellation(false)` opts out of the SDK's default behavior of
// cancelling in-flight requests when a new one with the same key fires.
// That behavior is meant for mobile/web with flaky networks — in a desktop
// app it just causes spurious "request was aborted" errors when React's
// StrictMode double-invokes effects in dev.
import PocketBase from "pocketbase";
import type { DesktopApi } from "@felafel/shared";

// `window.api` was injected by the preload script's `contextBridge` call;
// this declaration teaches TypeScript what's there. The runtime shape is
// guaranteed by the DesktopApi type from @felafel/shared.
declare global {
  interface Window {
    api: DesktopApi;
  }
}

export const pb = new PocketBase("");
pb.autoCancellation(false);

// Idempotent: safe to call from multiple components. Once `pb.authStore` is
// populated, subsequent calls short-circuit. The actual login uses the
// machine-generated superuser creds main persists in userData/admin.json —
// the user never types a password.
export async function ensurePocketBase(): Promise<PocketBase> {
  if (!pb.baseURL) {
    pb.baseURL = await window.api.pocketbaseUrl();
  }
  if (!pb.authStore.isValid) {
    const creds = await window.api.pocketbaseCredentials();
    if (!creds) {
      throw new Error("Main process did not provide superuser credentials");
    }
    await pb.collection("_superusers").authWithPassword(creds.email, creds.password);
  }
  return pb;
}
