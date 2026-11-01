/**
 * Schema proposal routes, mounted at `/api/ontologies/:ontologyKey/model`:
 * check one without writing, or apply it against the design revision its
 * check ran on. Both need the ontology's administrator, as every modeling
 * route (`access/routes.ts`). The body is never trusted: apply checks
 * everything again (`check.ts`).
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getModelingStore } from "../../core/ports.js";
import { applyProposal, checkProposal } from "./check.js";
import { DesignRevisionBody, Proposal } from "./proposal.js";

const OntologyParams = z.object({ ontologyKey: z.string() });

export const proposalRouter: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/proposals/check",
    { schema: { tags: ["modeling"], params: OntologyParams, body: z.object({ proposal: Proposal }).strict() } },
    async (request) => checkProposal(await getModelingStore(request.params.ontologyKey), request.body.proposal),
  );

  app.post(
    "/proposals/apply",
    {
      schema: {
        tags: ["modeling"], params: OntologyParams,
        body: z.object({ proposal: Proposal, expected: DesignRevisionBody }).strict(),
      },
    },
    async (request) => {
      const { ontologyKey } = request.params;
      const { proposal, expected } = request.body;
      return applyProposal(ontologyKey, await getModelingStore(ontologyKey), proposal, expected);
    },
  );
};
