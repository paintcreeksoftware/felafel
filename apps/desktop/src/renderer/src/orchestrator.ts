// Typed RPC client for the orchestrator service. The AppType import is
// type-only — Vite drops `import type` at compile time, so no orchestrator
// runtime (or its node:sqlite / @hono/zod-openapi deps) ends up in the
// renderer bundle.
import { hc } from "hono/client";
import { type AppType } from "@felafel/orchestrator/app";
import { type DesktopApi } from "@felafel/shared";

export type { OrchestratorStatus, Worker } from "@felafel/shared";

declare global {
  interface Window {
    api: DesktopApi;
  }
}

type OrchestratorClient = ReturnType<typeof hc<AppType>>;

/**
 * Build a typed Hono RPC client for the orchestrator.
 * @param baseUrl - orchestrator origin (e.g. `http://127.0.0.1:9090`)
 * @returns the typed Hono client
 */
export function makeClient(baseUrl: string): OrchestratorClient {
  return hc<AppType>(baseUrl);
}
