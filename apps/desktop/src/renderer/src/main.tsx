// React entry point. StrictMode double-invokes effects in development to
// surface accidental side effects — that's why pb.ts has to call
// `autoCancellation(false)`, otherwise the duplicate auth request gets
// auto-cancelled and surfaces as a misleading "request was aborted" error.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
