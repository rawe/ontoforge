/**
 * The Studio helper's routes, mounted at
 * `/api/ontologies/:ontologyKey/model` beside the modeling router: chat
 * and thread read under `/ai`. Every request needs the ontology's
 * administrator (`access/routes.ts`); its thread is bound to the whole
 * ontology (no lens), the helper and the request's principal, so no lens
 * route continues it and no other principal reads it. The turn streams as
 * the runtime's chats do (`runtime/chatStream.ts`).
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { ownerOf } from "../../access/authorize.js";
import { openThread, readThread, type ThreadBinding, type ThreadStore } from "../../assistants/index.js";
import { accessOf } from "../../auth/plugin.js";
import { getModelingStore } from "../../core/ports.js";
import { requireLanguageModel } from "../../runtime/assistants/kit/model.js";
import { ChatPayload, sendChatStream } from "../../runtime/chatStream.js";
import { Focus, runStudioChat, STUDIO_HELPER, STUDIO_KIND } from "./helper.js";

const OntologyParams = z.object({ ontologyKey: z.string() });
const ThreadParams = OntologyParams.extend({ threadId: z.string() });

/** The chat body: the shared one, plus what the page has open. */
export const StudioChatPayload = ChatPayload.extend({ focus: Focus.optional() }).strict();

async function studioBinding(request: FastifyRequest<{ Params: { ontologyKey: string } }>): Promise<ThreadBinding> {
  return {
    ontologyKey: request.params.ontologyKey, lensKey: null, kind: STUDIO_KIND,
    assistantKey: STUDIO_HELPER.key, owner: ownerOf(await accessOf(request)),
  };
}

/** Routes mounted at `/api/ontologies/:ontologyKey/model`; every chat runs on
 * a thread of the server's one thread store. */
export const studioHelperRouter: FastifyPluginAsyncZod<{ threads: ThreadStore }> = async (app, { threads }) => {
  app.post(
    "/ai/chat",
    { schema: { tags: ["ai"], params: OntologyParams, body: StudioChatPayload } },
    async (request, reply) => {
      const { ontologyKey } = request.params;
      const store = await getModelingStore(ontologyKey);
      const model = requireLanguageModel();
      const { message, threadId, focus } = request.body;
      const turn = await openThread(threads, await studioBinding(request), threadId);
      return sendChatStream(reply, { threads, turn }, (execution, thread) => runStudioChat(
        ontologyKey, { message, ...(focus === undefined ? {} : { focus }) }, store, model, thread, execution,
      ));
    },
  );

  // Reading needs no language model.
  app.get(
    "/ai/threads/:threadId",
    { schema: { tags: ["ai"], params: ThreadParams } },
    async (request) => {
      await getModelingStore(request.params.ontologyKey);
      return readThread(threads, await studioBinding(request), request.params.threadId);
    },
  );
};
