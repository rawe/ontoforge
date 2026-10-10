/**
 * AI runtime routes, mounted at
 * `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey` alongside the
 * runtime router: the agent list and agent chat, and the retriever routes
 * (`retrieverAgents/router.ts`), each under `/ai/assistants/<kind>`. Every
 * request binds a runtime store to the ontology its path names. Routers
 * parse and shape only; every rule lives in `aiService.ts`.
 *
 * There are deliberately NO MCP tools for chat — an MCP
 * client is itself a language model and gets the underlying tools
 * directly (`docs/interfaces.md`).
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getRuntimeStore } from "../core/ports.js";
import * as aiService from "./aiService.js";
import { sendChatStream } from "./chatStream.js";
import { retrieverAgentRuntimeRouter } from "./retrieverAgents/router.js";

const LensParams = z.object({ ontologyKey: z.string(), lensKey: z.string() });
const AssistantParams = LensParams.extend({ assistantKey: z.string() });

const AiChatMessage = z.object({
  role: z.string().regex(/^(user|assistant)$/),
  content: z.string(),
});

const AiChatPayload = z.looseObject({
  message: z.string().min(1),
  history: z.array(AiChatMessage).nullish(),
});

/** AI routes mounted at `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey`. */
export const aiRouter: FastifyPluginAsyncZod = async (app) => {
  await app.register(retrieverAgentRuntimeRouter);

  // --- Agents: the list and chat (the built-in default is `_default`) ---

  app.get(
    "/ai/assistants/agents",
    { schema: { tags: ["ai"], params: LensParams } },
    async (request) =>
      aiService.listRuntimeAgents(
        request.params.lensKey,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.post(
    "/ai/assistants/agents/:assistantKey/chat",
    { schema: { tags: ["ai"], params: AssistantParams, body: AiChatPayload } },
    async (request, reply) => {
      const store = await getRuntimeStore(request.params.ontologyKey);
      const config = await aiService.prepareChat(request.params.lensKey, store, request.params.assistantKey);
      return sendChatStream(reply, (execution) => aiService.runAgentChat(
        config, request.params.lensKey, request.body.message, store,
        request.body.history ?? null, false, execution,
      ));
    },
  );
};
