// React entry point. StrictMode double-invokes effects in development to
// surface accidental side effects — that's why pb.ts has to call
// `autoCancellation(false)`, otherwise the duplicate auth request gets
// auto-cancelled and surfaces as a misleading "request was aborted" error.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRendererSDK } from "@felafel/logs/browser";
import { Service } from "@felafel/logs/service";
import App from "@felafel/desktop/App";
import "@felafel/desktop/index.css";
import { IpcSpanExporter } from "@felafel/desktop/lib/ipc-span-exporter";

// Register OTel before React mounts so any span emitted by App's
// initial render (and the IPC calls it triggers) flows through the
// IpcSpanExporter to main (PAI-178).
const provider = createRendererSDK({
  service: Service.DESKTOP_RENDERER,
  exporter: new IpcSpanExporter(),
});
provider.register();

const rootElement = document.querySelector("#root");
if (!rootElement) {throw new Error("Root element #root not found");}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
