/**
 * Server routes, mounted at `/api/server` — the one phase-neutral
 * surface: read-only server-capability reads. Ontology-scoped operations
 * never live here, and server-wide data operations do not exist
 * (`docs/interfaces.md`).
 */

import { supportsKeywordRanking } from "../core/ports.js";
import { availableStrategies } from "../runtime/search/strategies.js";

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { settings } from "../config.js";

const FeaturesResponse = z.object({
  semanticSearch: z.boolean(),
  searchStrategies: z.array(z.string()),
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
    async () => {
      const keyword = await supportsKeywordRanking();
      return {
        semanticSearch: Boolean(settings.EMBEDDING_PROVIDER),
        searchStrategies: availableStrategies({ supportsKeywordRanking: () => keyword }),
        ai: Boolean(settings.AI_PROVIDER),
      };
    },
  );
};
