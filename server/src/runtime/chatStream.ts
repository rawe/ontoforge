/**
 * The runtime host of a chat turn over REST, shared by every assistant
 * kind: the request body, the thread binding with the request's principal,
 * and the NDJSON response. The turn itself runs in the assistants module
 * (`assistants/session.ts`).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ownerOf } from "../access/authorize.js";
import {
  streamTurn,
  type ChatTurn,
  type GraphThread,
  type StreamExecution,
  type ThreadBinding,
} from "../assistants/index.js";
import { accessOf } from "../auth/plugin.js";

/** The chat body every assistant kind shares; a kind may add fields. */
export const ChatPayload = z
  .object({
    message: z.string().min(1).max(2000),
    threadId: z.string().optional(),
  })
  .strict();

/** The assistant a chat's thread is bound to, named by the request's path,
 * and its owner: the request's principal, null when authentication is off. */
export async function threadBinding(
  request: FastifyRequest<{ Params: { ontologyKey: string; lensKey: string; assistantKey: string } }>,
  kind: string,
): Promise<ThreadBinding> {
  const { ontologyKey, lensKey, assistantKey } = request.params;
  return { ontologyKey, lensKey, kind, assistantKey, owner: ownerOf(await accessOf(request)) };
}

/** Takes the response over as an NDJSON stream. */
function openStream(reply: FastifyReply): void {
  const raw = reply.raw;
  reply.header("content-type", "application/x-ndjson");
  reply.header("cache-control", "no-cache");
  reply.header("x-accel-buffering", "no");
  reply.hijack();
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) raw.setHeader(name, value);
  }
  raw.writeHead(200);
  raw.flushHeaders();
}

export async function sendChatStream(
  reply: FastifyReply,
  turn: ChatTurn,
  run: (execution: StreamExecution, thread: GraphThread) => Promise<Record<string, unknown>>,
) {
  await streamTurn({ raw: reply.raw, open: () => openStream(reply) }, turn, run);
  return reply;
}
