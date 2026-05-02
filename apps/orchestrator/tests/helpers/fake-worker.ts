import { type AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { type JobAssignment } from "@felafel/shared";

export interface FakeWorker {
  url: string;
  received: JobAssignment[];
  setResponder: (
    r: (req: JobAssignment) => Response | Promise<Response>,
  ) => void;
  close: () => Promise<void>;
}

const ACCEPTED_STATUS = 202;

const defaultRespond = (): Response =>
  Response.json({ accepted: true }, { status: ACCEPTED_STATUS });

/**
 * Stand up a tiny in-process Hono server that pretends to be a worker —
 * accepts `POST /jobs/run`, records the payload, and returns whatever the
 * caller's `setResponder` last installed (defaults to 202 accepted).
 *
 * @returns a {@link FakeWorker} handle. Caller must call `close()` to
 * release the bound port.
 */
export async function startFakeWorker(): Promise<FakeWorker> {
  const received: JobAssignment[] = [];
  let respond: (
    req: JobAssignment,
  ) => Response | Promise<Response> = defaultRespond;

  const app = new Hono().post("/jobs/run", async (c) => {
    const body = (await c.req.json()) as JobAssignment;
    received.push(body);
    return respond(body);
  });

  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => {
    server.once("listening", () => {
      resolve();
    });
  });
  const address = server.address() as AddressInfo | null;
  if (address === null) {
    throw new Error("fake worker failed to bind");
  }

  return {
    url: `http://127.0.0.1:${address.port.toString()}`,
    received,
    setResponder(r) {
      respond = r;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}
