/**
 * REST delivery of one chat turn, shared by every assistant kind: the
 * request body, bounded writes, the shared events
 * (`thread` first, then the kind's events, one terminal `final` or
 * `error`), disconnect cancellation, and the turn's thread — committed on
 * success, rolled back on cancel or failure, its run lock released.
 */
import { once } from "node:events";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { NotFoundError, StoreError, ValidationError } from "../core/exceptions.js";
import type { ThreadBinding, ThreadStore } from "./threads/threadStore.js";

/** The chat body every assistant kind shares; a kind may add fields. */
export const ChatPayload = z
  .object({
    message: z.string().min(1).max(2000),
    threadId: z.string().optional(),
  })
  .strict();

/** The assistant a chat's thread is bound to, named by the request's path. */
export function threadBinding(
  params: { ontologyKey: string; lensKey: string; assistantKey: string },
  kind: string,
): ThreadBinding {
  return { ontologyKey: params.ontologyKey, lensKey: params.lensKey, kind, assistantKey: params.assistantKey };
}

/** NDJSON event envelope; callers define their event payloads. */
export type StreamEvent = { type: string; [key: string]: unknown };

export interface StreamExecution {
  signal: AbortSignal;
  onToolEvent: (event: StreamEvent) => Promise<void>;
}

/** The thread a turn runs on, its run lock already taken (`threads/access.ts`). */
export interface ChatTurn {
  threads: ThreadStore;
  threadId: string;
}

function publicError(error: unknown) {
  if (error instanceof NotFoundError) return {
    code: "RESOURCE_NOT_FOUND", message: error.message,
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
  run: (execution: StreamExecution) => Promise<Record<string, unknown>>,
) {
  const { threads, threadId } = turn;
  // Ends the turn once: kept or undone, then the lock released — before the
  // terminal event, so a client may send its next message as soon as it
  // has the answer.
  let open = true;
  const endTurn = async (complete: boolean) => {
    if (!open) return;
    open = false;
    try {
      await (complete ? threads.commitTurn(threadId) : threads.rollbackTurn(threadId));
    } finally {
      await threads.release(threadId);
    }
  };

  const controller = new AbortController();
  const { signal } = controller;
  const raw = reply.raw;
  if (raw.destroyed) {
    await endTurn(false);
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
    await threads.beginTurn(threadId);
    await write({ type: "thread", threadId });
    const result = await run({ signal, onToolEvent: write });
    await endTurn(true);
    await write({ type: "final", reply: result.reply });
  } catch (error) {
    // A cancelled or failed turn leaves nothing in its thread.
    await endTurn(false);
    if (!signal.aborted && !raw.destroyed && !terminal) {
      const payload = publicError(error);
      // Expected errors describe themselves to the client; anything else is
      // logged here, as the app's error handler does for plain requests.
      if (payload.code === "INTERNAL_ERROR") console.error("Chat stream failed:", error);
      try { await write({ type: "error", error: payload }); }
      catch { raw.destroy(); }
    }
  } finally {
    await endTurn(false);
    controller.abort();
    raw.removeListener("close", disconnect);
    if (!raw.destroyed) raw.end();
  }
  return reply;
}
