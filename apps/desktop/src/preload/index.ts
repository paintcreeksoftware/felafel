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
  type ForwardedSpan,
  type OrchestratorStatus,
  type TailscaleConnectResult,
  type TailscaleStatus,
} from "@felafel/shared";
import { tracedInvoke } from "@felafel/shared/traced-ipc";

const api: DesktopApi = {
  // Request/response calls use tracedInvoke so the renderer's W3C
  // traceparent crosses the IPC hop; one-way subscriptions
  // (ipcRenderer.on) stay bare because they have no response span.
  orchestratorUrl: () => tracedInvoke<typeof Channels.OrchestratorUrl, string>(Channels.OrchestratorUrl),
  orchestratorStatus: () =>
    tracedInvoke<typeof Channels.OrchestratorStatusGet, OrchestratorStatus>(Channels.OrchestratorStatusGet),
  onOrchestratorStatus: (handler) => {
    const listener = (_event: unknown, status: OrchestratorStatus) => handler(status);
    ipcRenderer.on(Channels.OrchestratorStatus, listener);
    return () => ipcRenderer.removeListener(Channels.OrchestratorStatus, listener);
  },
  tailscaleStatus: () => tracedInvoke<typeof Channels.TailscaleStatus, TailscaleStatus>(Channels.TailscaleStatus),
  tailscaleRefresh: () =>
    tracedInvoke<typeof Channels.TailscaleRefresh, TailscaleStatus>(Channels.TailscaleRefresh),
  tailscaleConnect: (authkey) =>
    tracedInvoke<typeof Channels.TailscaleConnect, TailscaleConnectResult>(Channels.TailscaleConnect, authkey),
  onTailscaleStatus: (handler) => {
    const listener = (_event: unknown, status: TailscaleStatus) => handler(status);
    ipcRenderer.on(Channels.TailscaleStatus, listener);
    return () => ipcRenderer.removeListener(Channels.TailscaleStatus, listener);
  },
  // PAI-178 renderer→main span forwarding. The renderer is
  // context-isolated and can't reach `ipcRenderer` directly; the
  // preload bridges the OtelSpan channel here. The renderer's
  // IpcSpanExporter calls `window.api.shipOtelSpan(span)` rather
  // than reaching for `tracedInvoke` itself.
  shipOtelSpan: (span: ForwardedSpan) =>
    tracedInvoke<typeof Channels.OtelSpan, void>(Channels.OtelSpan, span),
};

contextBridge.exposeInMainWorld("api", api);
