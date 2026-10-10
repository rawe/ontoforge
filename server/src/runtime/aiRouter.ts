/**
 * AI runtime routes, mounted at
 * `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey` alongside the
 * runtime router: the agent list, chat and thread read, and the retriever
 * routes (`assistants/retrievers/router.ts`), each under `/ai/assistants/<kind>`.
 * Every request binds a runtime store to the ontology its path names.
 * Routers parse and shape only; the rules live in `assistants/agents/runtime.ts` and
 * `threads/access.ts`.
 *
 * There are deliberately NO MCP tools for chat — an MCP
 * client is itself a language model and gets the underlying tools
 * directly (`docs/interfaces.md`).
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getRuntimeStore } from "../core/ports.js";
import * as agents from "./assistants/agents/runtime.js";
import { ChatPayload, sendChatStream, threadBinding } from "./chatStream.js";
import { retrieverRuntimeRouter } from "./assistants/retrievers/router.js";
import { loadSchema } from "./schemaCache.js";
import { openThread, readThread } from "./threads/access.js";
import type { ThreadStore } from "./threads/threadStore.js";

const LensParams = z.object({ ontologyKey: z.string(), lensKey: z.string() });
const AssistantParams = LensParams.extend({ assistantKey: z.string() });
const ThreadParams = AssistantParams.extend({ threadId: z.string() });

/** AI routes mounted at `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey`;
 * every chat runs on a thread of the server's one thread store. */
export const aiRouter: FastifyPluginAsyncZod<{ threads: ThreadStore }> = async (app, { threads }) => {
  await app.register(retrieverRuntimeRouter, { threads });

  // --- Agents: the list, chat and threads (the built-in default is `_default`) ---

  app.get(
    "/ai/assistants/agents",
    { schema: { tags: ["ai"], params: LensParams } },
    async (request) =>
      agents.listRuntimeAgents(
        request.params.lensKey,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.post(
    "/ai/assistants/agents/:assistantKey/chat",
    { schema: { tags: ["ai"], params: AssistantParams, body: ChatPayload } },
    async (request, reply) => {
      const store = await getRuntimeStore(request.params.ontologyKey);
      const config = await agents.prepareChat(request.params.lensKey, store, request.params.assistantKey);
      const threadId = await openThread(threads, threadBinding(request.params, "agents"), request.body.threadId);
      return sendChatStream(reply, { threads, threadId }, (execution) => agents.runAgentChat(
        config, request.params.lensKey, request.body.message, store,
        { checkpointer: threads.checkpointer, threadId }, execution,
      ));
    },
  );

  // Reading, like listing, needs no language model.
  app.get(
    "/ai/assistants/agents/:assistantKey/threads/:threadId",
    { schema: { tags: ["ai"], params: ThreadParams } },
    async (request) => {
      await loadSchema(request.params.lensKey, await getRuntimeStore(request.params.ontologyKey));
      return readThread(threads, threadBinding(request.params, "agents"), request.params.threadId);
    },
  );
};
