import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { RunSchema } from "@felafel/shared";

const PayloadSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
});

export const submitRunRoute = createRoute({
  method: "post",
  path: "/runs",
  description:
    "Enqueue a job and dispatch it to the first active worker. Returns " +
    "503 when no active worker is available; returns the Run record " +
    "(status='dispatched' on success, status='failed' if the dispatch " +
    "call to the worker errored).",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: PayloadSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Run dispatched (or marked failed on dispatch error)",
      content: {
        "application/json": {
          schema: RunSchema,
        },
      },
    },
    503: {
      description: "No active worker available to dispatch to",
      content: {
        "application/json": {
          schema: z.object({ message: z.string() }),
        },
      },
    },
  },
});

export const listRunsRoute = createRoute({
  method: "get",
  path: "/runs",
  description: "List all runs, ordered by createdAt DESC",
  responses: {
    200: {
      description: "All runs",
      content: {
        "application/json": {
          schema: z.array(RunSchema),
        },
      },
    },
  },
});

export const getRunRoute = createRoute({
  method: "get",
  path: "/runs/{id}",
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Single run",
      content: {
        "application/json": {
          schema: RunSchema,
        },
      },
    },
    404: {
      description: "No run with that id",
      content: {
        "application/json": {
          schema: z.object({ message: z.string() }),
        },
      },
    },
  },
});
