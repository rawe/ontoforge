/** Lens-local retriever agents, REST, under `assistants/retrievers`. Every rule lives in `retrieverAgents.ts`. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getModelingStore, getRuntimeStore } from "../core/ports.js";
import * as agents from "./retrieverAgents.js";

const Lens = z.object({ ontologyKey: z.string(), lensKey: z.string() });
const Agent = Lens.extend({ assistantKey: z.string() });

export const retrieverAgentModelingRouter: FastifyPluginAsyncZod = async (app) => {
  const stores = async (ontologyKey: string) =>
    [await getModelingStore(ontologyKey), await getRuntimeStore(ontologyKey)] as const;

  app.get(
    "/lenses/:lensKey/assistants/retrievers",
    { schema: { tags: ["modeling"], params: Lens, response: { 200: z.array(agents.RetrieverAgentResponse) } } },
    async (request) =>
      agents.listRetrieverAgents(request.params.lensKey, ...(await stores(request.params.ontologyKey))),
  );
  app.get(
    "/lenses/:lensKey/assistants/retrievers/:assistantKey",
    { schema: { tags: ["modeling"], params: Agent, response: { 200: agents.RetrieverAgentResponse } } },
    async (request) =>
      agents.getRetrieverAgent(
        request.params.lensKey,
        request.params.assistantKey,
        ...(await stores(request.params.ontologyKey)),
      ),
  );
  app.put(
    "/lenses/:lensKey/assistants/retrievers/:assistantKey",
    {
      schema: {
        tags: ["modeling"],
        params: Agent,
        body: agents.RetrieverAgentWriteBody,
        response: { 200: agents.RetrieverAgentResponse, 201: agents.RetrieverAgentResponse },
      },
    },
    async (request, reply) => {
      const [result, created] = await agents.saveRetrieverAgent(
        request.params.lensKey,
        request.params.assistantKey,
        request.body,
        ...(await stores(request.params.ontologyKey)),
      );
      return reply.status(created ? 201 : 200).send(result);
    },
  );
  app.delete(
    "/lenses/:lensKey/assistants/retrievers/:assistantKey",
    { schema: { tags: ["modeling"], params: Agent } },
    async (request, reply) => {
      await agents.deleteRetrieverAgent(
        request.params.lensKey,
        request.params.assistantKey,
        await getModelingStore(request.params.ontologyKey),
      );
      return reply.status(204).send();
    },
  );
  for (const operation of ["copy", "move"] as const) {
    app.post(
      `/lenses/:lensKey/assistants/retrievers/:assistantKey/${operation}`,
      {
        schema: {
          tags: ["modeling"],
          params: Agent,
          body: agents.RetrieverAgentTransferBody,
          response: { [operation === "copy" ? 201 : 200]: agents.RetrieverAgentResponse },
        },
      },
      async (request, reply) => {
        const result = await agents.transferRetrieverAgent(
          request.params.lensKey,
          request.params.assistantKey,
          request.body,
          operation === "copy",
          ...(await stores(request.params.ontologyKey)),
        );
        return reply.status(operation === "copy" ? 201 : 200).send(result);
      },
    );
  }
  app.get(
    "/lenses/:lensKey/assistants/retrievers/:assistantKey/export",
    { schema: { tags: ["modeling"], params: Agent, response: { 200: agents.PortableRetrieverAgent } } },
    async (request) =>
      agents.exportRetrieverAgent(
        request.params.lensKey,
        request.params.assistantKey,
        await getModelingStore(request.params.ontologyKey),
      ),
  );
  app.post(
    "/lenses/:lensKey/assistants/retrievers/import",
    {
      schema: {
        tags: ["modeling"],
        params: Lens,
        body: agents.RetrieverAgentImportBody,
        response: { 201: agents.RetrieverAgentResponse },
      },
    },
    async (request, reply) => {
      const result = await agents.importRetrieverAgent(
        request.params.lensKey,
        request.body,
        ...(await stores(request.params.ontologyKey)),
      );
      return reply.status(201).send(result);
    },
  );
};
