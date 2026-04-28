// Preload script — runs in the renderer's process but with Node access, before
// any page JS loads. The ONLY way the renderer can talk to main is through what
// we expose here via contextBridge.
//
// This is the security boundary. With `contextIsolation: true` (set in main),
// the renderer cannot reach `ipcRenderer`, `require`, or any Node API directly
// — it only sees the `api` object below on `window.api`. If a malicious npm
// package made it into the renderer bundle, this is the wall it can't get past.
import { contextBridge, ipcRenderer } from "electron";
import {
  Channels,
  type DesktopApi,
  type PocketBaseStatus,
  type SuperuserCredentials,
} from "@felafel/shared";

const api: DesktopApi = {
  pocketbaseUrl: () => ipcRenderer.invoke(Channels.PocketBaseUrl) as Promise<string>,
  pocketbaseCredentials: () =>
    ipcRenderer.invoke(Channels.PocketBaseCredentials) as Promise<SuperuserCredentials>,
  // Push notifications from main → renderer. Returns an unsubscribe so React
  // effects can clean up properly.
  onPocketBaseStatus: (handler) => {
    const listener = (_event: unknown, status: PocketBaseStatus) => handler(status);
    ipcRenderer.on(Channels.PocketBaseStatus, listener);
    return () => ipcRenderer.removeListener(Channels.PocketBaseStatus, listener);
  },
};

contextBridge.exposeInMainWorld("api", api);
