import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  description: "Worker liveness probe",
  responses: {
    200: {
      description: "Worker is up",
      content: {
        "application/json": {
          schema: z.object({ ok: z.literal(true) }),
        },
      },
    },
  },
});
