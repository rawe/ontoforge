/** Retriever-agent chat and retrieve. The saved agent (or the lens's
 * derived default agent) runs; a request can never supply a configuration. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getRuntimeStore } from "../../core/ports.js";
import { sendChatStream } from "../chatStream.js";
import { chat, loadRunnableAgent, requireLanguageModel, retrieveQuestion } from "./runtime.js";

const Params = z.object({ ontologyKey: z.string(), lensKey: z.string(), agentKey: z.string() });
const Chat = z
  .object({
    message: z.string().min(1).max(2000),
    turnToken: z.string().max(100).optional(),
    diagnostics: z.boolean().default(false),
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(12000) }))
      .max(30)
      .default([]),
  })
  .strict();
const Retrieve = z
  .object({
    question: z.string().min(1).max(2000),
    diagnostics: z.boolean().default(false),
  })
  .strict();

export const retrieverAgentRuntimeRouter: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/retriever-agents/:agentKey/chat",
    { schema: { tags: ["ai"], params: Params, body: Chat } },
    async (request, reply) => {
      requireLanguageModel();
      const store = await getRuntimeStore(request.params.ontologyKey);
      // Resolved before the stream opens: unknown and invalid agents answer
      // with a plain error response.
      const agent = await loadRunnableAgent(request.params.lensKey, request.params.agentKey, store);
      return sendChatStream(reply, (execution) =>
        chat(
          request.params.lensKey,
          agent,
          request.body.message,
          request.body.history,
          execution,
          request.body.turnToken,
          request.body.diagnostics,
        ),
      );
    },
  );

  app.post(
    "/retriever-agents/:agentKey/retrieve",
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
        const agent = await loadRunnableAgent(request.params.lensKey, request.params.agentKey, store);
        return await retrieveQuestion(agent, request.body.question, request.body.diagnostics, controller.signal);
      } finally {
        request.raw.removeListener("aborted", disconnect);
        reply.raw.removeListener("close", disconnect);
      }
    },
  );
};
