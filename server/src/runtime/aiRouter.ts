/**
 * AI runtime routes, mounted at
 * `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey` alongside the
 * runtime router: ask, chat (default and per-agent), agent
 * discovery, the A2A card and task endpoints, and retriever-agent chat
 * (`retrieverAgents/router.ts`). Every request binds a runtime store to
 * the ontology its path names. Routers parse and shape only; every rule
 * lives in `aiService.ts`.
 *
 * There are deliberately NO MCP tools for ask/chat — an MCP
 * client is itself a language model and gets the underlying tools
 * directly (`docs/interfaces.md`).
 */

import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { settings } from "../config.js";
import { DEFAULT_AGENT_CONFIG } from "../core/ai.js";
import { NotFoundError } from "../core/exceptions.js";
import { getRuntimeStore } from "../core/ports.js";
import * as aiService from "./aiService.js";
import { sendChatStream } from "./chatStream.js";
import { loadSchema } from "./schemaCache.js";
import { retrieverAgentRuntimeRouter } from "./retrieverAgents/router.js";

const LensParams = z.object({ ontologyKey: z.string(), lensKey: z.string() });
const AgentParams = LensParams.extend({ agentKey: z.string() });

const AiQueryPayload = z.looseObject({
  question: z.string().min(1),
});

const AiChatMessage = z.object({
  role: z.string().regex(/^(user|assistant)$/),
  content: z.string(),
});

const AiChatPayload = z.looseObject({
  message: z.string().min(1),
  history: z.array(AiChatMessage).nullish(),
});

/** A2A task submissions carry a JSON-RPC 2.0 object; it is handed to the
 * service raw, unshaped. */
const A2aPayload = z.record(z.string(), z.unknown());

/** Resolve the advertised base URL: `PUBLIC_URL` when configured, else the
 * request's forwarded-protocol and host headers. */
export function getBaseUrl(request: FastifyRequest): string {
  if (settings.PUBLIC_URL) {
    return settings.PUBLIC_URL.replace(/\/+$/, "");
  }
  const forwardedProto = request.headers["x-forwarded-proto"];
  const scheme = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : (forwardedProto ?? request.protocol);
  const hostHeader = request.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : (hostHeader ?? request.hostname);
  return `${scheme}://${host}`;
}

/** AI routes mounted at `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey`. */
export const aiRouter: FastifyPluginAsyncZod = async (app) => {
  await app.register(retrieverAgentRuntimeRouter);
  app.post(
    "/ai/query",
    { schema: { tags: ["ai"], params: LensParams, body: AiQueryPayload } },
    async (request) =>
      aiService.aiQuery(
        request.params.lensKey,
        request.body.question,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

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

  // --- A2A / Agent Card Endpoints ---

  app.get(
    "/ai/.well-known/agent.json",
    { schema: { tags: ["ai"], params: LensParams } },
    async (request) => {
      const loaded = await loadSchema(
        request.params.lensKey,
        await getRuntimeStore(request.params.ontologyKey),
      );
      return aiService.buildAgentCard(
        DEFAULT_AGENT_CONFIG,
        request.params.ontologyKey,
        loaded.scoped,
        getBaseUrl(request),
      );
    },
  );

  app.post(
    "/ai/a2a",
    { schema: { tags: ["ai"], params: LensParams, body: A2aPayload } },
    async (request) =>
      aiService.handleA2aTask(
        DEFAULT_AGENT_CONFIG,
        request.params.lensKey,
        request.body,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.get(
    "/ai/agents/:agentKey/.well-known/agent.json",
    { schema: { tags: ["ai"], params: AgentParams } },
    async (request) => {
      const loaded = await loadSchema(
        request.params.lensKey,
        await getRuntimeStore(request.params.ontologyKey),
      );
      const config = loaded.agentConfigs[request.params.agentKey];
      if (!config) {
        throw new NotFoundError(`AI agent '${request.params.agentKey}' not found`);
      }
      return aiService.buildAgentCard(
        config,
        request.params.ontologyKey,
        loaded.scoped,
        getBaseUrl(request),
      );
    },
  );

  app.post(
    "/ai/agents/:agentKey/a2a",
    { schema: { tags: ["ai"], params: AgentParams, body: A2aPayload } },
    async (request) => {
      const store = await getRuntimeStore(request.params.ontologyKey);
      const loaded = await loadSchema(request.params.lensKey, store);
      const config = loaded.agentConfigs[request.params.agentKey];
      if (!config) {
        throw new NotFoundError(`AI agent '${request.params.agentKey}' not found`);
      }
      return aiService.handleA2aTask(config, request.params.lensKey, request.body, store);
    },
  );
};
