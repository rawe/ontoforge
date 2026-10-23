/** Navigators at runtime, under `/ai/assistants/navigators`: the list,
 * chat and its threads. The saved navigator (or the lens's derived default
 * navigator, `_default`) runs; a request can never supply a configuration. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getRuntimeStore } from "../../../core/ports.js";
import { ChatPayload, sendChatStream, threadBinding } from "../../chatStream.js";
import { loadSchema } from "../../schemaCache.js";
import { openThread, readThread } from "../../threads/access.js";
import type { ThreadStore } from "../../threads/threadStore.js";
import { requireLanguageModel } from "../kit/model.js";
import { listRuntimeNavigators, loadRunnableNavigator, runNavigatorTurn } from "./runtime.js";

const LensParams = z.object({ ontologyKey: z.string(), lensKey: z.string() });
const Params = LensParams.extend({ assistantKey: z.string() });
const ThreadParams = Params.extend({ threadId: z.string() });

export const navigatorRuntimeRouter: FastifyPluginAsyncZod<{ threads: ThreadStore }> = async (app, { threads }) => {
  app.get(
    "/ai/assistants/navigators",
    { schema: { tags: ["ai"], params: LensParams } },
    async (request) =>
      listRuntimeNavigators(request.params.lensKey, await getRuntimeStore(request.params.ontologyKey)),
  );

  app.post(
    "/ai/assistants/navigators/:assistantKey/chat",
    { schema: { tags: ["ai"], params: Params, body: ChatPayload } },
    async (request, reply) => {
      requireLanguageModel();
      const { lensKey, assistantKey } = request.params;
      const store = await getRuntimeStore(request.params.ontologyKey);
      // Resolved before the stream opens: unknown and invalid navigators
      // answer with a plain error response.
      const navigator = await loadRunnableNavigator(lensKey, assistantKey, store);
      const turn = await openThread(threads, await threadBinding(request, "navigators"), request.body.threadId);
      return sendChatStream(reply, { threads, turn }, (execution, thread) =>
        runNavigatorTurn(navigator, lensKey, store, request.body.message, thread, execution),
      );
    },
  );

  // Reading, like listing, needs no language model.
  app.get(
    "/ai/assistants/navigators/:assistantKey/threads/:threadId",
    { schema: { tags: ["ai"], params: ThreadParams } },
    async (request) => {
      await loadSchema(request.params.lensKey, await getRuntimeStore(request.params.ontologyKey));
      return readThread(threads, await threadBinding(request, "navigators"), request.params.threadId);
    },
  );
};
