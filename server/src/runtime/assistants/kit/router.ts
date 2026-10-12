/** Every registered kind at runtime, under `/ai/assistants/<kind>`: the
 * list, chat and its threads — the same routes for every kind, the
 * built-in default addressed by `_default`. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getRuntimeStore } from "../../../core/ports.js";
import { ChatPayload, sendChatStream, threadBinding } from "../../chatStream.js";
import { loadSchema } from "../../schemaCache.js";
import { openThread, readThread } from "../../threads/access.js";
import type { ThreadStore } from "../../threads/threadStore.js";
import { ASSISTANT_KINDS } from "../kinds/index.js";
import { requireLanguageModel } from "./model.js";
import { listRuntimeAssistants, loadRunnable, runTurn } from "./runtime.js";

const LensParams = z.object({ ontologyKey: z.string(), lensKey: z.string() });
const Params = LensParams.extend({ assistantKey: z.string() });
const ThreadParams = Params.extend({ threadId: z.string() });

export const assistantKindsRuntimeRouter: FastifyPluginAsyncZod<{ threads: ThreadStore }> = async (app, { threads }) => {
  for (const kind of ASSISTANT_KINDS) {
    const base = `/ai/assistants/${kind.kind}`;

    app.get(base, { schema: { tags: ["ai"], params: LensParams } }, async (request) =>
      listRuntimeAssistants(kind, request.params.lensKey, await getRuntimeStore(request.params.ontologyKey)),
    );

    app.post(
      `${base}/:assistantKey/chat`,
      { schema: { tags: ["ai"], params: Params, body: ChatPayload } },
      async (request, reply) => {
        requireLanguageModel();
        const { lensKey, assistantKey } = request.params;
        const store = await getRuntimeStore(request.params.ontologyKey);
        // Resolved before the stream opens: unknown and invalid assistants
        // answer with a plain error response.
        const runnable = await loadRunnable(kind, lensKey, assistantKey, store);
        const threadId = await openThread(threads, threadBinding(request.params, kind.kind), request.body.threadId);
        return sendChatStream(reply, { threads, threadId }, (execution) =>
          runTurn(kind, runnable, lensKey, store, request.body.message,
            { checkpointer: threads.checkpointer, threadId }, execution),
        );
      },
    );

    // Reading, like listing, needs no language model.
    app.get(
      `${base}/:assistantKey/threads/:threadId`,
      { schema: { tags: ["ai"], params: ThreadParams } },
      async (request) => {
        await loadSchema(request.params.lensKey, await getRuntimeStore(request.params.ontologyKey));
        return readThread(threads, threadBinding(request.params, kind.kind), request.params.threadId);
      },
    );
  }
};
