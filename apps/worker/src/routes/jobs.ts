import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { JobAssignmentSchema } from "@felafel/shared";

export const runJobRoute = createRoute({
  method: "post",
  path: "/jobs/run",
  description:
    "Orchestrator-dispatched job. Worker returns 202 immediately and " +
    "executes the job asynchronously, then POSTs /runs/:id/complete to " +
    "the orchestrator when done.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: JobAssignmentSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description:
        "Job accepted. The completion result will arrive on the " +
        "orchestrator's POST /runs/:id/complete endpoint.",
      content: {
        "application/json": {
          schema: z.object({ accepted: z.literal(true) }),
        },
      },
    },
  },
});
