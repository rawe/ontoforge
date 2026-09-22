/** REST delivery only: bounded writes, terminal events, and disconnect cancellation. */
import { once } from "node:events";
import type { FastifyReply } from "fastify";
import { NotFoundError, StoreError, ValidationError } from "../core/exceptions.js";

/** Any NDJSON stream event; chat sends tool events, decision search its own steps. */
export type StreamEvent = { type: string; [key: string]: unknown };

export interface StreamExecution {
  signal: AbortSignal;
  onToolEvent: (event: StreamEvent) => Promise<void>;
}

function publicError(error: unknown) {
  if (error instanceof NotFoundError) return { code: "RESOURCE_NOT_FOUND", message: error.message };
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
  run: (execution: StreamExecution) => Promise<Record<string, unknown>>,
) {
  const controller = new AbortController();
  const { signal } = controller;
  const raw = reply.raw;
  if (raw.destroyed) return reply;
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
    const result = await run({ signal, onToolEvent: write });
    await write({ type: "final", reply: result.reply });
  } catch (error) {
    if (!signal.aborted && !raw.destroyed && !terminal) {
      reply.log.error(error);
      try { await write({ type: "error", error: publicError(error) }); }
      catch { raw.destroy(); }
    }
  } finally {
    controller.abort();
    raw.removeListener("close", disconnect);
    if (!raw.destroyed) raw.end();
  }
  return reply;
}
