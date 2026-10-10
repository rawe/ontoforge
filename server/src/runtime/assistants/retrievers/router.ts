/** Retrievers at runtime, under `/ai/assistants/retrievers`: the
 * list, chat, its threads and retrieve. The saved retriever (or the lens's
 * derived default retriever, `_default`) runs; a request can never supply a
 * configuration. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getRuntimeStore } from "../../../core/ports.js";
import { ChatPayload, sendChatStream, threadBinding } from "../../chatStream.js";
import { openThread, readThread } from "../../threads/access.js";
import type { ThreadStore } from "../../threads/threadStore.js";
import {
  chat,
  listRuntimeRetrievers,
  loadRunnableRetriever,
  requireLanguageModel,
  requireRetrievers,
  retrieveQuestion,
} from "./runtime.js";

const LensParams = z.object({ ontologyKey: z.string(), lensKey: z.string() });
const Params = LensParams.extend({ assistantKey: z.string() });
const ThreadParams = Params.extend({ threadId: z.string() });
const Chat = ChatPayload.extend({ diagnostics: z.boolean().default(false) }).strict();
const Retrieve = z.object({ query: z.string().min(1).max(2000) }).strict();

export const retrieverRuntimeRouter: FastifyPluginAsyncZod<{ threads: ThreadStore }> = async (app, { threads }) => {
  app.get(
    "/ai/assistants/retrievers",
    { schema: { tags: ["ai"], params: LensParams } },
    async (request) =>
      listRuntimeRetrievers(request.params.lensKey, await getRuntimeStore(request.params.ontologyKey)),
  );

  app.post(
    "/ai/assistants/retrievers/:assistantKey/chat",
    { schema: { tags: ["ai"], params: Params, body: Chat } },
    async (request, reply) => {
      requireLanguageModel();
      const store = await getRuntimeStore(request.params.ontologyKey);
      // Resolved before the stream opens: unknown and invalid retrievers answer
      // with a plain error response.
      const agent = await loadRunnableRetriever(request.params.lensKey, request.params.assistantKey, store);
      const threadId = await openThread(threads, threadBinding(request.params, "retrievers"), request.body.threadId);
      return sendChatStream(reply, { threads, threadId }, (execution) =>
        chat(
          agent,
          request.body.message,
          { checkpointer: threads.checkpointer, threadId },
          execution,
          request.body.diagnostics,
        ),
      );
    },
  );

  // Reading, like listing, needs no language model.
  app.get(
    "/ai/assistants/retrievers/:assistantKey/threads/:threadId",
    { schema: { tags: ["ai"], params: ThreadParams } },
    async (request) => {
      await requireRetrievers(request.params.lensKey, await getRuntimeStore(request.params.ontologyKey));
      return readThread(threads, threadBinding(request.params, "retrievers"), request.params.threadId);
    },
  );

  app.post(
    "/ai/assistants/retrievers/:assistantKey/retrieve",
    { schema: { tags: ["ai"], params: Params, body: Retrieve } },
    async (request, reply) => {
      requireLanguageModel();
      const controller = new AbortController();
      const disconnect = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      request.raw.once("aborted", disconnect);
      reply.raw.once("close", disconnect);
      if (request.raw.aborted || reply.raw.destroyed) controller.abort();
      try {
        const store = await getRuntimeStore(request.params.ontologyKey);
        const agent = await loadRunnableRetriever(request.params.lensKey, request.params.assistantKey, store);
        return await retrieveQuestion(agent, request.body.query, controller.signal);
      } finally {
        request.raw.removeListener("aborted", disconnect);
        reply.raw.removeListener("close", disconnect);
      }
    },
  );
};
