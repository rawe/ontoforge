/**
 * REST delivery of one chat turn, shared by every assistant kind: the
 * request body, bounded writes, the shared events
 * (`thread` first, then the kind's events, one terminal `final` or
 * `error`), disconnect cancellation, and the turn's thread: the graph runs
 * on a local saver seeded from the thread's last published state, which is
 * published on success and dropped on cancel or failure, the lease released.
 */
import { once } from "node:events";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ownerOf } from "../access/authorize.js";
import { accessOf } from "../auth/plugin.js";
import { ConflictError, NotFoundError, StoreError, ValidationError } from "../core/exceptions.js";
import { threadBusy, threadNotFound } from "./threads/access.js";
import {
  TURN_HEARTBEAT_MS,
  type GraphThread,
  type ThreadBinding,
  type ThreadStore,
  type Turn,
} from "./threads/threadStore.js";
import { TurnSaver } from "./threads/turnSaver.js";

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

/** NDJSON event envelope; callers define their event payloads. */
export type StreamEvent = { type: string; [key: string]: unknown };

export interface StreamExecution {
  signal: AbortSignal;
  onToolEvent: (event: StreamEvent) => Promise<void>;
}

/** The turn a chat runs, its lease already taken (`threads/access.ts`). */
export interface ChatTurn {
  threads: ThreadStore;
  turn: Turn;
}

function publicError(error: unknown) {
  if (error instanceof NotFoundError) return {
    code: "RESOURCE_NOT_FOUND", message: error.message,
    ...(error.details === null ? {} : { details: error.details }),
  };
  if (error instanceof ConflictError) return {
    code: "RESOURCE_CONFLICT", message: error.message,
    ...(error.details === null ? {} : { details: error.details }),
  };
  if (error instanceof ValidationError) return {
    code: "VALIDATION_ERROR", message: error.message,
    ...(error.details === null ? {} : { details: error.details }),
  };
  if (error instanceof StoreError) return {
    code: "STORAGE_ERROR", message: error.message, details: { errorId: error.errorId },
  };
  return { code: "INTERNAL_ERROR", message: "Internal Server Error" };
}

export async function sendChatStream(
  reply: FastifyReply,
  turn: ChatTurn,
  run: (execution: StreamExecution, thread: GraphThread) => Promise<Record<string, unknown>>,
) {
  const { threads, turn: owned } = turn;
  const { threadId } = owned;
  // The heartbeat keeps the lease while the turn runs. A lost lease does not
  // abort the turn: its publish is refused anyway.
  const heartbeat = setInterval(() => {
    threads.renew(owned).then(
      (renewed) => { if (!renewed) console.warn(`Thread ${threadId}: the running turn lost its lease`); },
      (error) => console.error(`Thread ${threadId}: renewing the turn's lease failed:`, error),
    );
  }, TURN_HEARTBEAT_MS);
  heartbeat.unref();
  // Ends the turn once. Publishing ends it too; otherwise the lease is
  // released — before the terminal event, so a client may send its next
  // message as soon as it has the answer. A failed release is logged only:
  // the lease runs out on its own.
  let open = true;
  const endTurn = async () => {
    clearInterval(heartbeat);
    if (!open) return;
    open = false;
    try {
      await threads.release(owned);
    } catch (error) {
      console.error(`Thread ${threadId}: releasing the turn failed:`, error);
    }
  };

  let saver: TurnSaver;
  try {
    saver = TurnSaver.load(threadId, owned.state);
  } catch (error) {
    await endTurn();
    throw error;
  }
  const controller = new AbortController();
  const { signal } = controller;
  const raw = reply.raw;
  if (raw.destroyed) {
    await endTurn();
    return reply;
  }
  let terminal = false;
  const disconnect = () => controller.abort();
  raw.once("close", disconnect);
  reply.header("content-type", "application/x-ndjson");
  reply.header("cache-control", "no-cache");
  reply.header("x-accel-buffering", "no");
  reply.hijack();
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) raw.setHeader(name, value);
  }
  raw.writeHead(200);
  raw.flushHeaders();

  // Tool batches may finish concurrently. A bounded writable queue avoids
  // retaining arbitrarily many payloads while a slow consumer catches up.
  const write = async (event: StreamEvent) => {
    signal.throwIfAborted();
    if (terminal) return;
    const line = JSON.stringify(event) + "\n";
    if (event.type !== "error" && raw.writableLength + Buffer.byteLength(line) > 8 * 1024 * 1024) {
      throw new ValidationError("Chat stream exceeded its buffer limit");
    }
    if (event.type === "final" || event.type === "error") terminal = true;
    if (!raw.write(line)) {
      await once(raw, "drain", { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
    }
  };
  try {
    await write({ type: "thread", threadId });
    const result = await run({ signal, onToolEvent: write }, { checkpointer: saver, threadId });
    const published = await threads.publish(owned, saver.dump());
    open = false;
    clearInterval(heartbeat);
    if (published === "taken") throw threadBusy();
    if (published === "gone") throw threadNotFound();
    await write({ type: "final", reply: result.reply });
  } catch (error) {
    // A cancelled or failed turn leaves nothing in its thread.
    await endTurn();
    if (!signal.aborted && !raw.destroyed && !terminal) {
      const payload = publicError(error);
      // Expected errors describe themselves to the client; anything else is
      // logged here, as the app's error handler does for plain requests.
      if (payload.code === "INTERNAL_ERROR") console.error("Chat stream failed:", error);
      try { await write({ type: "error", error: payload }); }
      catch { raw.destroy(); }
    }
  } finally {
    await endTurn();
    controller.abort();
    raw.removeListener("close", disconnect);
    if (!raw.destroyed) raw.end();
  }
  return reply;
}
