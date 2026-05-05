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

/**
 * Schema for a 409 response from DELETE /workers/{id} when one or more
 * runs reference the worker. Includes the count so the renderer can
 * surface it in the inline error message ("12 runs reference this worker
 * — can't forget yet").
 */
const DeleteWorkerBlockedSchema = z.object({
  message: z.string(),
  referencingRunCount: z.number().int().nonnegative(),
});

export const deleteWorkerRoute = createRoute({
  method: "delete",
  path: "/workers/{id}",
  description:
    "Hard-delete a worker by wire UUID. Refuses (409) if any rows in " +
    "`runs` reference this worker — preserves run history rather than " +
    "orphaning the FK or cascading deletes.",
  request: {
    params: z.object({ id: z.uuid() }),
  },
  responses: {
    204: {
      description: "Worker deleted; no body.",
    },
    404: {
      description: "No worker with that id.",
      content: {
        "application/json": {
          schema: z.object({ message: z.string() }),
        },
      },
    },
    409: {
      description: "Cannot delete: one or more runs reference this worker.",
      content: {
        "application/json": {
          schema: DeleteWorkerBlockedSchema,
        },
      },
    },
  },
});
