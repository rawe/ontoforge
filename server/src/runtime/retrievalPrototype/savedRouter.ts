/** Saved execution resolves configuration on the server; request bodies cannot override it. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { getModelingStore, getRuntimeStore } from "../../core/ports.js";
import { executable } from "../../modeling/retrievers.js";
import { sendChatStream } from "../chatStream.js";
import { prepare, chat } from "./runtime.js";
const Params = z.object({ ontologyKey: z.string(), lensKey: z.string(), retrieverKey: z.string() });
const Chat = z.object({
  message: z.string().min(1).max(2000), turnToken: z.string().max(100).optional(),
  diagnostics: z.boolean().default(false),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(12000) })).max(30).default([]),
}).strict();
export const savedRetrieverRouter: FastifyPluginAsyncZod = async (app) => {
  app.post('/retrievers/:retrieverKey/prepare', { schema: { tags: ['ai'], params: Params, body: z.object({}).strict().nullish() } }, async (request, reply) => {
    const store = await getRuntimeStore(request.params.ontologyKey);
    const config = await executable(request.params.lensKey, request.params.retrieverKey, await getModelingStore(request.params.ontologyKey), store);
    const controller = new AbortController();
    const close = () => controller.abort();
    reply.raw.once('close', close);
    try {
      return await prepare(request.params.lensKey, store, config, controller.signal);
    }
    finally {
      reply.raw.removeListener('close', close);
      controller.abort();
    }
  });
  app.post('/retrievers/:retrieverKey/chat', { schema: { tags: ['ai'], params: Params, body: Chat } }, async (request, reply) => {
    const store = await getRuntimeStore(request.params.ontologyKey);
    const config = await executable(request.params.lensKey, request.params.retrieverKey, await getModelingStore(request.params.ontologyKey), store);
    return sendChatStream(reply, execution => chat(request.params.lensKey, store, config, request.body.message, request.body.history, execution, request.body.turnToken, request.body.diagnostics));
  });
};
