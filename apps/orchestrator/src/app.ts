import { Hono } from "hono";
import { health } from "./routes/health";

export function buildApp() {
  return new Hono().route("/", health);
}

export type AppType = ReturnType<typeof buildApp>;
