/**
 * Server routes, mounted at `/api/server` — the one phase-neutral
 * surface: read-only reads describing the deployment. Ontology-scoped
 * operations never live here, and server-wide data operations do not exist
 * (`docs/interfaces/`).
 */

import { supportsKeywordRanking } from "../core/ports.js";
import { deploymentMethods } from "../runtime/search/availability.js";
import { availableStrategies } from "../runtime/search/strategies.js";

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { settings } from "../config.js";
import { getDecisionModel } from "../core/decision.js";
import { SERVER_VERSION } from "../version.js";

const InfoResponse = z.object({
  baseUrl: z.string().nullable(),
  version: z.string(),
  authentication: z.boolean(),
});

const FeaturesResponse = z.object({
  semanticSearch: z.boolean(),
  searchStrategies: z.array(z.string()),
  ai: z.boolean(),
  decisions: z.boolean(),
});

/** Routes mounted at `/api/server`. */
export const serverRouter: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/info",
    {
      schema: {
        tags: ["server"],
        response: { 200: InfoResponse },
      },
    },
    async () => ({
      baseUrl: settings.PUBLIC_URL?.replace(/\/+$/, "") ?? null,
      version: SERVER_VERSION,
      authentication: app.auth !== null,
    }),
  );

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
      const capabilities = { supportsKeywordRanking: () => keyword };
      return {
        semanticSearch: deploymentMethods(capabilities).includes("semantic"),
        searchStrategies: availableStrategies(capabilities),
        ai: Boolean(settings.AI_PROVIDER),
        decisions: getDecisionModel() !== null,
      };
    },
  );
};
