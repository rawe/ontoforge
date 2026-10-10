/**
 * AI runtime routes, mounted at
 * `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey` alongside the
 * runtime router: chat (default and per-agent), agent discovery, and
 * retriever-agent chat (`retrieverAgents/router.ts`). Every request binds a
 * runtime store to the ontology its path names. Routers parse and shape
 * only; every rule lives in `aiService.ts`.
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
const AgentParams = LensParams.extend({ agentKey: z.string() });

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
  app.post(
    "/ai/chat",
    { schema: { tags: ["ai"], params: LensParams, body: AiChatPayload } },
    async (request, reply) => {
      const store = await getRuntimeStore(request.params.ontologyKey);
      const config = await aiService.prepareChat(request.params.lensKey, store);
      return sendChatStream(reply, (execution) => aiService.runAgentChat(
        config, request.params.lensKey, request.body.message, store,
        request.body.history ?? null, false, execution,
      ));
    },
  );

  // --- Agent discovery and per-agent chat ---

  app.get(
    "/ai/agents",
    { schema: { tags: ["ai"], params: LensParams } },
    async (request) =>
      aiService.listRuntimeAgents(
        request.params.lensKey,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.post(
    "/ai/agents/:agentKey/chat",
    { schema: { tags: ["ai"], params: AgentParams, body: AiChatPayload } },
    async (request, reply) => {
      const store = await getRuntimeStore(request.params.ontologyKey);
      const config = await aiService.prepareChat(request.params.lensKey, store, request.params.agentKey);
      return sendChatStream(reply, (execution) => aiService.runAgentChat(
        config, request.params.lensKey, request.body.message, store,
        request.body.history ?? null, false, execution,
      ));
    },
  );
};
