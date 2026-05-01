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
  type OrchestratorStatus,
  type TailscaleConnectResult,
  type TailscaleStatus,
} from "@felafel/shared";

const api: DesktopApi = {
  // Push notifications from main → renderer. Returns an unsubscribe so React
  // effects can clean up properly.
  orchestratorUrl: () => ipcRenderer.invoke(Channels.OrchestratorUrl) as Promise<string>,
  onOrchestratorStatus: (handler) => {
    const listener = (_event: unknown, status: OrchestratorStatus) => handler(status);
    ipcRenderer.on(Channels.OrchestratorStatus, listener);
    return () => ipcRenderer.removeListener(Channels.OrchestratorStatus, listener);
  },
  tailscaleStatus: () => ipcRenderer.invoke(Channels.TailscaleStatus) as Promise<TailscaleStatus>,
  tailscaleRefresh: () =>
    ipcRenderer.invoke(Channels.TailscaleRefresh) as Promise<TailscaleStatus>,
  tailscaleConnect: (authkey) =>
    ipcRenderer.invoke(Channels.TailscaleConnect, authkey) as Promise<TailscaleConnectResult>,
  onTailscaleStatus: (handler) => {
    const listener = (_event: unknown, status: TailscaleStatus) => handler(status);
    ipcRenderer.on(Channels.TailscaleStatus, listener);
    return () => ipcRenderer.removeListener(Channels.TailscaleStatus, listener);
  },
};

contextBridge.exposeInMainWorld("api", api);
