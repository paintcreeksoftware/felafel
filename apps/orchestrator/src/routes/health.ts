import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  description: "Service liveness probe",
  responses: {
    200: {
      description: "Service is up",
      content: {
        "application/json": {
          schema: z.object({ ok: z.literal(true) }),
        },
      },
    },
  },
});
