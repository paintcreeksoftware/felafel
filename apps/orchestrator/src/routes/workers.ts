import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { WorkerRegistrationSchema, WorkerSchema } from "@felafel/shared";

export const listWorkersRoute = createRoute({
  method: "get",
  path: "/workers",
  description: "List all registered workers, ordered by registeredAt DESC",
  responses: {
    200: {
      description: "All registered workers",
      content: {
        "application/json": {
          schema: z.array(WorkerSchema),
        },
      },
    },
  },
});

export const registerWorkerRoute = createRoute({
  method: "post",
  path: "/workers",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: WorkerRegistrationSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Worker upserted (same id → update; new id → create)",
      content: {
        "application/json": {
          schema: WorkerSchema,
        },
      },
    },
  },
});
