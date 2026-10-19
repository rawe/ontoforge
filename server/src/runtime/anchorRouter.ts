/** Anchor maintenance, REST, mounted at `/api/ontologies/:ontologyKey/runtime/anchors`:
 * lensless, beside the lens mounts. Every rule lives in `anchors.ts`. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getRuntimeStore } from "../core/ports.js";
import * as anchors from "./anchors.js";

const Ontology = z.object({ ontologyKey: z.string() });
const Anchor = Ontology.extend({ anchorKey: z.string() });

export const anchorRouter: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    { schema: { tags: ["runtime"], params: Ontology, response: { 200: z.array(anchors.AnchorResponse) } } },
    async (request) => anchors.listAnchors(await getRuntimeStore(request.params.ontologyKey)),
  );
  app.get(
    "/:anchorKey",
    { schema: { tags: ["runtime"], params: Anchor, response: { 200: anchors.AnchorResponse } } },
    async (request) =>
      anchors.readAnchor(request.params.anchorKey, await getRuntimeStore(request.params.ontologyKey)),
  );
  app.put(
    "/:anchorKey",
    {
      schema: {
        tags: ["runtime"],
        params: Anchor,
        body: anchors.AnchorWriteBody,
        response: { 200: anchors.AnchorResponse },
      },
    },
    async (request) =>
      anchors.saveAnchor(
        request.params.anchorKey,
        request.body,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );
  app.delete(
    "/:anchorKey",
    { schema: { tags: ["runtime"], params: Anchor } },
    async (request, reply) => {
      await anchors.deleteAnchor(request.params.anchorKey, await getRuntimeStore(request.params.ontologyKey));
      return reply.status(204).send();
    },
  );
};
