/**
 * The steps of one turn, for the shared `diagnostics` event every assistant
 * kind sends when a chat asks for it. One recorder per turn (`session.ts`),
 * used by every engine around each piece of work it does: a model call is
 * a model step, anything else (a tool call, a pipeline step that calls no
 * model) a work step. Each step is timed and, once it ended — failed too —
 * sent as one entry of `steps`; every send is awaited by the step's own
 * code, so it reaches the stream before the turn's terminal event. Last,
 * the session sends the whole turn's `durationMs`. Without diagnostics
 * nothing is sent.
 *
 * An entry: `index` (1, 2, … in the order the steps started), `name` (the
 * pipeline step or the tool; absent for a tool loop's model call), `model:
 * true` on a model step, `startMs` (since the turn began) and `durationMs`,
 * whole milliseconds; on a model step `usage` (`core/usage.ts`) and
 * `finishReason` as the provider reported them; `failed: true` for a step
 * that threw; `plan`, what a planning step decided.
 */

import type { BaseMessage } from "@langchain/core/messages";

import { finishReason } from "../core/ai.js";
import { tokenUsage } from "../core/usage.js";
import type { StreamEvent } from "./session.js";

type Row = Record<string, unknown>;

/** What a model call that completed reported. */
export interface CallEnd {
  /** LangChain's `usage_metadata` of the whole call. */
  usage?: unknown;
  finishReason?: string;
}

/** One model step, started: ended exactly once, by `done` or `failed`. */
export interface ModelStep {
  /** The call completed — also one whose answer is then refused as cut off
   * or unreadable. `plan` is what the step decided, when it could be read. */
  done(end: CallEnd, plan?: Row): Promise<void>;
  /** The call threw: no usage. */
  failed(): Promise<void>;
}

/** What a whole answer message reported. */
export function messageEnd(message: BaseMessage): CallEnd {
  const usage = (message as { usage_metadata?: unknown }).usage_metadata;
  return {
    usage,
    finishReason: finishReason(message.response_metadata) ?? finishReason(message.additional_kwargs),
  };
}

export class Diagnostics {
  private started = 0;
  private readonly begun = performance.now();

  /** `send` writes one event to the turn's stream; none sends nothing. The
   * turn begins now. */
  constructor(private readonly send?: (event: StreamEvent) => Promise<void>) {}

  /** Starts one model step. */
  model(name?: string): ModelStep {
    const step = this.begin(name, true);
    return {
      done: async (end, plan) => {
        const usage = tokenUsage(end.usage);
        await step({
          ...(usage === undefined ? {} : { usage }),
          ...(end.finishReason === undefined ? {} : { finishReason: end.finishReason }),
          ...(plan === undefined ? {} : { plan }),
        });
      },
      failed: () => step({ failed: true }),
    };
  }

  /** Runs `run` as one work step: failed when it throws (the error goes on). */
  async work<T>(name: string, run: () => Promise<T>): Promise<T> {
    const step = this.begin(name, false);
    let result: T;
    try {
      result = await run();
    } catch (error) {
      await step({ failed: true });
      throw error;
    }
    await step({});
    return result;
  }

  /** Sends the whole turn's time. */
  async total(): Promise<void> {
    await this.send?.({ type: "diagnostics", durationMs: this.since(this.begun) });
  }

  private since(time: number): number {
    return Math.round(performance.now() - time);
  }

  /** Starts a step; the returned function ends it and sends its entry. */
  private begin(name: string | undefined, model: boolean): (fields: Row) => Promise<void> {
    const index = ++this.started;
    const begun = performance.now();
    const startMs = Math.round(begun - this.begun);
    return async (fields) => {
      await this.send?.({
        type: "diagnostics",
        steps: [{
          index,
          ...(name === undefined ? {} : { name }),
          ...(model ? { model: true } : {}),
          startMs,
          durationMs: this.since(begun),
          ...fields,
        }],
      });
    };
  }
}
