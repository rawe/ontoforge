/** Lens-local saved retriever REST surface. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { getModelingStore, getRuntimeStore } from "../core/ports.js";
import * as retrievers from "./retrievers.js";

const Lens = z.object({ ontologyKey: z.string(), lensKey: z.string() });
const Key = Lens.extend({ retrieverKey: z.string() });

export const retrieverModelingRouter: FastifyPluginAsyncZod = async (app) => {
  const stores = async (key: string) =>
    [await getModelingStore(key), await getRuntimeStore(key)] as const;

  app.get(
    "/lenses/:lensKey/retrievers",
    { schema: { tags: ["modeling"], params: Lens, response: { 200: z.array(retrievers.RetrieverResponse) } } },
    async request => retrievers.list(
      request.params.lensKey, ...await stores(request.params.ontologyKey),
    ),
  );
  app.get(
    "/lenses/:lensKey/retrievers/:retrieverKey",
    { schema: { tags: ["modeling"], params: Key, response: { 200: retrievers.RetrieverResponse } } },
    async request => retrievers.read(
      request.params.lensKey, request.params.retrieverKey,
      ...await stores(request.params.ontologyKey),
    ),
  );
  app.put(
    "/lenses/:lensKey/retrievers/:retrieverKey",
    {
      schema: {
        tags: ["modeling"], params: Key, body: retrievers.RetrieverWrite,
        response: { 200: retrievers.RetrieverResponse, 201: retrievers.RetrieverResponse },
      },
    },
    async (request, reply) => {
      const [result, created] = await retrievers.write(
        request.params.lensKey, request.params.retrieverKey, request.body,
        ...await stores(request.params.ontologyKey),
      );
      return reply.status(created ? 201 : 200).send(result);
    },
  );
  app.delete(
    "/lenses/:lensKey/retrievers/:retrieverKey",
    { schema: { tags: ["modeling"], params: Key } },
    async (request, reply) => {
      await retrievers.remove(
        request.params.lensKey, request.params.retrieverKey,
        await getModelingStore(request.params.ontologyKey),
      );
      return reply.status(204).send();
    },
  );
  for (const operation of ["copy", "move"] as const) {
    app.post(
      `/lenses/:lensKey/retrievers/:retrieverKey/${operation}`,
      { schema: { tags: ["modeling"], params: Key, body: retrievers.RetrieverTransfer } },
      async (request, reply) => {
        const result = await retrievers.transfer(
          request.params.lensKey, request.params.retrieverKey, request.body,
          operation === "copy", ...await stores(request.params.ontologyKey),
        );
        return reply.status(operation === "copy" ? 201 : 200).send(result);
      },
    );
  }
  app.get(
    "/lenses/:lensKey/retrievers/:retrieverKey/export",
    { schema: { tags: ["modeling"], params: Key, response: { 200: retrievers.StoredRetrieverExport } } },
    async request => retrievers.portable(await retrievers.getStored(
      request.params.lensKey, request.params.retrieverKey,
      await getModelingStore(request.params.ontologyKey),
    )),
  );
  app.post(
    "/lenses/:lensKey/retrievers/import",
    { schema: { tags: ["modeling"], params: Lens, body: retrievers.RetrieverExport, response: { 201: retrievers.RetrieverResponse } } },
    async (request, reply) => {
      const { key, ...body } = request.body;
      const [result] = await retrievers.write(
        request.params.lensKey, key, body,
        ...await stores(request.params.ontologyKey), true,
      );
      return reply.status(201).send(result);
    },
  );
};
