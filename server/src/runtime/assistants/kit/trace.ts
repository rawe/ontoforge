/**
 * The live trace every kind of the seam streams (`kind.ts`). Event shapes
 * are the same for every kind, prefixed with its event noun:
 *
 * - `<event>.graph` — the kind's topology, once, first;
 * - `<event>.step` — a step `running`, then `done`, `skipped` or `failed`,
 *   with a plain summary and its duration; `round` counts repeats;
 * - `<event>.entities` — entity cards and the links between them, upserted
 *   by ref, before the answer;
 * - `<event>.summary` — model calls, duration and counts, once, last;
 * - the answer as the shared `delta` events.
 *
 * Summaries are written for people: display names, never ids or keys.
 */

import type { StreamEvent } from "../../chatStream.js";
import type { Topology } from "./kind.js";

export type StepStatus = "running" | "done" | "skipped" | "failed";

/** One entity as the client shows it. */
export interface EntityCard {
  /** `E1`, `E2`, … in discovery order; unique within a turn. */
  ref: string;
  id: string;
  type: string;
  typeName: string;
  label: string;
  role: "anchor" | "reached" | "focus";
  /** Distance from the nearest anchor. */
  hop: number;
  /** Why the entity is here, in plain words. */
  reason: string;
  fields: { name: string; value: string }[];
  /** Handed to the answer model; only evidence can be cited. */
  evidence: boolean;
}

/** A relation between two cards, directed as stored. */
export interface CardLink {
  from: string;
  to: string;
  type: string;
  label: string;
}

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

  entities(entities: EntityCard[], links: CardLink[]): Promise<void> {
    return this.emit({ type: `${this.event}.entities`, entities, links });
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
