/**
 * Diagnostics: the steps of one turn, sent as the shared `diagnostics`
 * event when a chat asks for it (`diagnostics: true`). The same for every
 * assistant kind: nothing in the event, and nothing in a client, depends
 * on the kind.
 *
 * A step is one piece of work the engine did for the answer: one model
 * call (a model step) or anything else (a work step: a tool call, a
 * search, a pipeline step that calls no model). Its entry:
 *
 * - `index`: 1, 2, … in the order the steps started;
 * - `name`: a stable key in lower case with underscores (`plan`,
 *   `get_entity`). A client shows it as words ("Get entity"), so choose one
 *   that reads well that way. Absent only on a tool loop's model call;
 * - `model: true` on a model step;
 * - `startMs` (since the turn began) and `durationMs`, whole milliseconds;
 * - on a model step `usage` (`core/usage.ts`) and `finishReason`, as the
 *   provider reported them;
 * - `failed: true` when the step threw;
 * - `detail`: optional plain text about what the step did or decided, for
 *   the person reading diagnostics. Display names, never keys, ids or
 *   JSON; line breaks are kept. Never needed to show the answer.
 *
 * Adding diagnostics to an assistant kind is recording its steps here, and
 * nothing else — a client shows any step as it comes:
 *
 * - take the turn's recorder from `StreamExecution.diagnostics`
 *   (`session.ts` creates one per turn and sends the turn's time last);
 * - a model call: `const step = diagnostics.model("plan")`, then exactly
 *   one of `await step.done(messageEnd(response), detail)` and
 *   `await step.failed()`;
 * - other work: `await diagnostics.work("retrieve", async (step) => …)`,
 *   which may set `step.detail`.
 *
 * Each entry is sent when its step ends, failed too, and awaited by the
 * step's own code, so it reaches the stream before the turn's terminal
 * event. Unless the chat asked for diagnostics, nothing is sent. What the
 * assistant did and found (tool calls, progress, entities) is not
 * diagnostics: it stays on the kind's own events, which are always sent.
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
   * or unreadable. `detail` says what the step decided, when that could be
   * read. */
  done(end: CallEnd, detail?: string): Promise<void>;
  /** The call threw: no usage. */
  failed(): Promise<void>;
}

/** One work step while it runs. */
export interface WorkStep {
  /** What the step did or decided, when there is something to say. */
  detail?: string;
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
      done: async (end, detail) => {
        const usage = tokenUsage(end.usage);
        await step({
          ...(usage === undefined ? {} : { usage }),
          ...(end.finishReason === undefined ? {} : { finishReason: end.finishReason }),
          ...(detail === undefined ? {} : { detail }),
        });
      },
      failed: () => step({ failed: true }),
    };
  }

  /** Runs `run` as one work step: failed when it throws (the error goes on). */
  async work<T>(name: string, run: (step: WorkStep) => Promise<T>): Promise<T> {
    const end = this.begin(name, false);
    const step: WorkStep = {};
    let result: T;
    try {
      result = await run(step);
    } catch (error) {
      await end({ failed: true });
      throw error;
    }
    await end(step.detail === undefined ? {} : { detail: step.detail });
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
