// Typed RPC client for the orchestrator service. The AppType import is
// type-only — Vite drops `import type` at compile time, so no orchestrator
// runtime (or its node:sqlite / @hono/zod-openapi deps) ends up in the
// renderer bundle.
import { hc } from "hono/client";
import { type AppType } from "@felafel/orchestrator/app";
import { type DesktopApi, type OrchestratorStatus, type Worker } from "@felafel/shared";

declare global {
  interface Window {
    api: DesktopApi;
  }
}

export type OrchestratorClient = ReturnType<typeof hc<AppType>>;

export function makeClient(baseUrl: string): OrchestratorClient {
  return hc<AppType>(baseUrl);
}

export type { OrchestratorStatus, Worker };
