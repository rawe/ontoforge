/**
 * Runtime routes. Only the lens-free `features` route exists yet; the
 * ontology-scoped routes arrive with the runtime slices.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { settings } from "../config.js";

const FeaturesResponse = z.object({
  semanticSearch: z.boolean(),
  ai: z.boolean(),
});

/** Routes mounted at `/api/runtime` that take no ontology key. */
export const runtimeGlobalRouter: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/features",
    {
      schema: {
        tags: ["runtime"],
        response: { 200: FeaturesResponse },
      },
    },
    async () => ({
      semanticSearch: Boolean(settings.EMBEDDING_PROVIDER),
      ai: Boolean(settings.AI_PROVIDER),
    }),
  );
};
