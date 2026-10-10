/** Lens-local retrievers, REST, under `assistants/retrievers`. Every rule lives in `retrievers.ts`. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getModelingStore, getRuntimeStore } from "../core/ports.js";
import * as retrievers from "./retrievers.js";

const Lens = z.object({ ontologyKey: z.string(), lensKey: z.string() });
const Retriever = Lens.extend({ assistantKey: z.string() });

export const retrieverModelingRouter: FastifyPluginAsyncZod = async (app) => {
  const stores = async (ontologyKey: string) =>
    [await getModelingStore(ontologyKey), await getRuntimeStore(ontologyKey)] as const;

  app.get(
    "/lenses/:lensKey/assistants/retrievers",
    { schema: { tags: ["modeling"], params: Lens, response: { 200: z.array(retrievers.RetrieverResponse) } } },
    async (request) =>
      retrievers.listRetrievers(request.params.lensKey, ...(await stores(request.params.ontologyKey))),
  );
  app.get(
    "/lenses/:lensKey/assistants/retrievers/:assistantKey",
    { schema: { tags: ["modeling"], params: Retriever, response: { 200: retrievers.RetrieverResponse } } },
    async (request) =>
      retrievers.getRetriever(
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
        params: Retriever,
        body: retrievers.RetrieverWriteBody,
        response: { 200: retrievers.RetrieverResponse, 201: retrievers.RetrieverResponse },
      },
    },
    async (request, reply) => {
      const [result, created] = await retrievers.saveRetriever(
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
    { schema: { tags: ["modeling"], params: Retriever } },
    async (request, reply) => {
      await retrievers.deleteRetriever(
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
          params: Retriever,
          body: retrievers.RetrieverTransferBody,
          response: { [operation === "copy" ? 201 : 200]: retrievers.RetrieverResponse },
        },
      },
      async (request, reply) => {
        const result = await retrievers.transferRetriever(
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
    { schema: { tags: ["modeling"], params: Retriever, response: { 200: retrievers.PortableRetriever } } },
    async (request) =>
      retrievers.exportRetriever(
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
        body: retrievers.RetrieverImportBody,
        response: { 201: retrievers.RetrieverResponse },
      },
    },
    async (request, reply) => {
      const result = await retrievers.importRetriever(
        request.params.lensKey,
        request.body,
        ...(await stores(request.params.ontologyKey)),
      );
      return reply.status(201).send(result);
    },
  );
};
