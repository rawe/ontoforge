/**
 * The live trace every kind of the seam streams (`kind.ts`). Event shapes
 * are the same for every kind, prefixed with its event noun:
 *
 * - `<event>.graph` — the kind's topology, once, first;
 * - `<event>.step` — a step `running`, then `done`, `skipped` or `failed`,
 *   with a plain summary and its duration; `round` counts repeats;
 * - the shared `entities` event (`../entities.ts`) — entity cards and the
 *   links between them, upserted by ref, before the answer;
 * - `<event>.summary` — model calls, duration and counts, once, last;
 * - the answer as the shared `delta` events.
 *
 * Summaries are written for people: display names, never ids or keys.
 */

import type { StreamEvent } from "../../chatStream.js";
import { entitiesEvent, type EntityCard, type EntityLink } from "../entities.js";
import type { Topology } from "./kind.js";

export type StepStatus = "running" | "done" | "skipped" | "failed";

/** What a step reports while it runs. */
export interface StepReport {
  summary?: string;
}

export class Trace {
  private readonly rounds = new Map<string, number>();
  readonly timings: Record<string, number> = {};
  modelCalls = 0;
  private readonly started = performance.now();

  constructor(
    private readonly event: string,
    private readonly emit: (event: StreamEvent) => Promise<void>,
    private readonly signal: AbortSignal,
  ) {}

  graph(topology: Topology): Promise<void> {
    return this.emit({ type: `${this.event}.graph`, ...topology });
  }

  /** Runs one step: `running`, then `done` with the summary the step set,
   * or `failed` when it throws (the error goes on). */
  async step<T>(id: string, run: (report: StepReport) => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    const round = (this.rounds.get(id) ?? 0) + 1;
    this.rounds.set(id, round);
    await this.emit({ type: `${this.event}.step`, id, status: "running", round });
    const report: StepReport = {};
    const start = performance.now();
    let status: StepStatus = "failed";
    try {
      const result = await run(report);
      status = "done";
      return result;
    } finally {
      const durationMs = Math.round(performance.now() - start);
      this.timings[id] = (this.timings[id] ?? 0) + durationMs;
      if (!this.signal.aborted) {
        await this.emit({
          type: `${this.event}.step`, id, status, round, durationMs,
          ...(report.summary ? { summary: report.summary } : {}),
        });
      }
    }
  }

  /** A step the turn does not need. */
  async skip(id: string, summary: string): Promise<void> {
    this.signal.throwIfAborted();
    const round = (this.rounds.get(id) ?? 0) + 1;
    this.rounds.set(id, round);
    await this.emit({ type: `${this.event}.step`, id, status: "skipped", round, summary });
  }

  /** Answer text, as the shared `delta` event. */
  delta(text: string): Promise<void> {
    return this.emit({ type: "delta", text });
  }

  entities(entities: EntityCard[], links: EntityLink[]): Promise<void> {
    return this.emit(entitiesEvent(entities, links));
  }

  summary(counts: Record<string, number>): Promise<void> {
    return this.emit({
      type: `${this.event}.summary`,
      modelCalls: this.modelCalls,
      durationMs: Math.round(performance.now() - this.started),
      ...counts,
      timings: this.timings,
    });
  }
}
