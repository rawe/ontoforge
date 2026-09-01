/**
 * Server routes, mounted at `/api/server` — the one phase-neutral
 * surface: read-only server-capability reads. Ontology-scoped operations
 * never live here, and server-wide data operations do not exist
 * (`docs/interfaces.md`).
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { settings } from "../config.js";

const FeaturesResponse = z.object({
  semanticSearch: z.boolean(),
  ai: z.boolean(),
});

/** Routes mounted at `/api/server`. */
export const serverRouter: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/features",
    {
      schema: {
        tags: ["server"],
        response: { 200: FeaturesResponse },
      },
    },
    async () => ({
      semanticSearch: Boolean(settings.EMBEDDING_PROVIDER),
      ai: Boolean(settings.AI_PROVIDER),
    }),
  );
};
