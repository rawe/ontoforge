/** Every registered assistant kind, REST, under `assistants/<kind>`. Every rule lives in `assistants.ts`. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getModelingStore, getRuntimeStore } from "../core/ports.js";
import { ASSISTANT_KINDS } from "../runtime/assistants/kinds/index.js";
import * as assistants from "./assistants.js";

const Lens = z.object({ ontologyKey: z.string(), lensKey: z.string() });
const Assistant = Lens.extend({ assistantKey: z.string() });

export const assistantModelingRouter: FastifyPluginAsyncZod = async (app) => {
  const stores = async (ontologyKey: string) =>
    [await getModelingStore(ontologyKey), await getRuntimeStore(ontologyKey)] as const;

  for (const kind of ASSISTANT_KINDS) {
    const base = `/lenses/:lensKey/assistants/${kind.kind}`;

    app.get(
      base,
      { schema: { tags: ["modeling"], params: Lens, response: { 200: z.array(assistants.AssistantResponse) } } },
      async (request) => assistants.listAssistants(kind, request.params.lensKey, ...(await stores(request.params.ontologyKey))),
    );
    app.get(
      `${base}/:assistantKey`,
      { schema: { tags: ["modeling"], params: Assistant, response: { 200: assistants.AssistantResponse } } },
      async (request) =>
        assistants.getAssistant(
          kind, request.params.lensKey, request.params.assistantKey, ...(await stores(request.params.ontologyKey)),
        ),
    );
    app.put(
      `${base}/:assistantKey`,
      {
        schema: {
          tags: ["modeling"],
          params: Assistant,
          body: assistants.AssistantWriteBody,
          response: { 200: assistants.AssistantResponse, 201: assistants.AssistantResponse },
        },
      },
      async (request, reply) => {
        const [result, created] = await assistants.saveAssistant(
          kind, request.params.lensKey, request.params.assistantKey, request.body,
          ...(await stores(request.params.ontologyKey)),
        );
        return reply.status(created ? 201 : 200).send(result);
      },
    );
    app.delete(
      `${base}/:assistantKey`,
      { schema: { tags: ["modeling"], params: Assistant } },
      async (request, reply) => {
        await assistants.deleteAssistant(
          kind, request.params.lensKey, request.params.assistantKey, await getModelingStore(request.params.ontologyKey),
        );
        return reply.status(204).send();
      },
    );
  }
};
