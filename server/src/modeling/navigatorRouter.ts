/** Lens-local navigators, REST, under `assistants/navigators`. Every rule lives in `navigators.ts`. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getModelingStore, getRuntimeStore } from "../core/ports.js";
import * as navigators from "./navigators.js";

const Lens = z.object({ ontologyKey: z.string(), lensKey: z.string() });
const Navigator = Lens.extend({ assistantKey: z.string() });

export const navigatorModelingRouter: FastifyPluginAsyncZod = async (app) => {
  const stores = async (ontologyKey: string) =>
    [await getModelingStore(ontologyKey), await getRuntimeStore(ontologyKey)] as const;

  app.get(
    "/lenses/:lensKey/assistants/navigators",
    { schema: { tags: ["modeling"], params: Lens, response: { 200: z.array(navigators.NavigatorResponse) } } },
    async (request) =>
      navigators.listNavigators(request.params.lensKey, ...(await stores(request.params.ontologyKey))),
  );
  app.get(
    "/lenses/:lensKey/assistants/navigators/:assistantKey",
    { schema: { tags: ["modeling"], params: Navigator, response: { 200: navigators.NavigatorResponse } } },
    async (request) =>
      navigators.getNavigator(
        request.params.lensKey,
        request.params.assistantKey,
        ...(await stores(request.params.ontologyKey)),
      ),
  );
  app.put(
    "/lenses/:lensKey/assistants/navigators/:assistantKey",
    {
      schema: {
        tags: ["modeling"],
        params: Navigator,
        body: navigators.NavigatorWriteBody,
        response: { 200: navigators.NavigatorResponse, 201: navigators.NavigatorResponse },
      },
    },
    async (request, reply) => {
      const [result, created] = await navigators.saveNavigator(
        request.params.lensKey,
        request.params.assistantKey,
        request.body,
        ...(await stores(request.params.ontologyKey)),
      );
      return reply.status(created ? 201 : 200).send(result);
    },
  );
  app.delete(
    "/lenses/:lensKey/assistants/navigators/:assistantKey",
    { schema: { tags: ["modeling"], params: Navigator } },
    async (request, reply) => {
      await navigators.deleteNavigator(
        request.params.lensKey,
        request.params.assistantKey,
        await getModelingStore(request.params.ontologyKey),
      );
      return reply.status(204).send();
    },
  );
};
