/** Retriever-agent chat. The saved agent runs; a request can never supply a configuration. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getRuntimeStore } from "../../core/ports.js";
import { sendChatStream } from "../chatStream.js";
import { chat, loadRunnableAgent } from "./runtime.js";

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

export const retrieverAgentRuntimeRouter: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/retriever-agents/:agentKey/chat",
    { schema: { tags: ["ai"], params: Params, body: Chat } },
    async (request, reply) => {
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
};
