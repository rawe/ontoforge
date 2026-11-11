/**
 * The model calls of one turn, for the shared `diagnostics` event every
 * assistant kind sends when a chat asks for it. One recorder per turn
 * (`session.ts`), used by every engine around each model call it makes:
 * the call is timed and, once it ended — failed too — sent as one entry of
 * `modelCalls`. Every send is awaited by the call's own code, so it reaches
 * the stream before the turn's terminal event. Without diagnostics nothing
 * is sent; the calls are still counted.
 *
 * An entry: `index` (1, 2, … in the order the calls started), `name` (the
 * step that made the call, where the kind has steps), `durationMs`,
 * `usage` (`core/usage.ts`) and `finishReason` as the provider reported
 * them, or `failed: true` for a call that threw; then any detail its
 * caller adds (the retriever's texts).
 */

import type { BaseMessage } from "@langchain/core/messages";

import { finishReason } from "../core/ai.js";
import { tokenUsage } from "../core/usage.js";
import type { StreamEvent } from "./session.js";

type Row = Record<string, unknown>;

/** What a call that completed reported. */
export interface CallEnd {
  /** LangChain's `usage_metadata` of the whole call. */
  usage?: unknown;
  finishReason?: string;
}

/** One model call, started: ended exactly once, by `done` or `failed`. */
export interface ModelCall {
  /** The call completed — also one whose answer is then refused as cut off. */
  done(end: CallEnd, detail?: Row): Promise<void>;
  /** The call threw: no usage. */
  failed(detail?: Row): Promise<void>;
}

/** What a whole answer message reported. */
export function messageEnd(message: BaseMessage): CallEnd {
  const usage = (message as { usage_metadata?: unknown }).usage_metadata;
  return {
    usage,
    finishReason: finishReason(message.response_metadata) ?? finishReason(message.additional_kwargs),
  };
}

export class ModelCalls {
  private started = 0;

  /** `send` writes one event to the turn's stream; none records nothing. */
  constructor(private readonly send?: (event: StreamEvent) => Promise<void>) {}

  /** How many calls the turn started. */
  get count(): number {
    return this.started;
  }

  /** Starts one call; `detail` goes on its entry however it ends. */
  start(name?: string, detail: Row = {}): ModelCall {
    const index = ++this.started;
    const begun = performance.now();
    const entry = () => ({
      index,
      ...(name === undefined ? {} : { name }),
      durationMs: Math.round(performance.now() - begun),
    });
    return {
      done: async (end, more = {}) => {
        const usage = tokenUsage(end.usage);
        await this.report({
          modelCalls: [{
            ...entry(),
            ...(usage === undefined ? {} : { usage }),
            ...(end.finishReason === undefined ? {} : { finishReason: end.finishReason }),
            ...detail, ...more,
          }],
        });
      },
      failed: async (more = {}) => {
        await this.report({ modelCalls: [{ ...entry(), failed: true, ...detail, ...more }] });
      },
    };
  }

  /** Sends the kind's own diagnostics fields, when the turn asked for them. */
  async report(fields: Row): Promise<void> {
    await this.send?.({ type: "diagnostics", ...fields });
  }
}
