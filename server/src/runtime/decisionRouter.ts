/** Decision-specific REST routes; independent of AI chat and ranked search. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { getRuntimeStore } from "../core/ports.js";
import { compareEntities } from "./decisionService.js";

const Snapshot = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
const CompareEntitiesPayload = z.strictObject({
  entityTypeKey: z.string().min(1),
  left: Snapshot,
  right: Snapshot,
});
const probability = z.number().min(0).max(1);
const CompareEntitiesResponse = z.object({
  decision: z.enum(["same", "different", "insufficient"]),
  probabilities: z.object({ same: probability, different: probability, insufficient: probability }),
  confidence: probability,
  truncatedFields: z.array(z.string()),
});

export const decisionRouter: FastifyPluginAsyncZod = async (app) => {
  app.post("/decisions/compare-entities", {
    schema: {
      tags: ["decisions"],
      params: z.object({ ontologyKey: z.string(), lensKey: z.string() }),
      body: CompareEntitiesPayload,
      response: { 200: CompareEntitiesResponse },
    },
  }, async (request, reply) => {
    const controller = new AbortController();
    const disconnect = () => { if (!reply.raw.writableEnded) controller.abort(); };
    request.raw.once("aborted", disconnect);
    reply.raw.once("close", disconnect);
    if (request.raw.aborted || reply.raw.destroyed) controller.abort();
    try {
      return await compareEntities(request.params.lensKey, request.body,
        await getRuntimeStore(request.params.ontologyKey), controller.signal);
    } finally {
      request.raw.removeListener("aborted", disconnect);
      reply.raw.removeListener("close", disconnect);
    }
  });
};
