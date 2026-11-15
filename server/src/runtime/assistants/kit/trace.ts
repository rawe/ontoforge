/**
 * The live trace of an assistant that runs a fixed pipeline of steps — a
 * navigator (`../navigators/`). Event shapes are fixed, prefixed with the
 * assistant's event noun:
 *
 * - `<event>.graph` — the pipeline's topology, once, first;
 * - `<event>.step` — a step `running`, then `done`, `skipped` or `failed`,
 *   with a plain summary of what it did; `round` counts repeats;
 * - the shared `entities` event (`../entities.ts`) — entity cards and the
 *   links between them, upserted by ref, before the answer;
 * - the answer as the shared `delta` events;
 * - when the chat asked for it, the shared `diagnostics` event after each
 *   step that ran (`diagnostics`): a step that calls the model is recorded
 *   by its model call, named by the step; any other is a work step.
 *
 * Summaries are written for people: display names, never ids or keys.
 */

import { Diagnostics, type StreamEvent } from "../../../assistants/index.js";
import { entitiesEvent, type EntityCard, type EntityLink } from "../entities.js";

/** One step of a pipeline, as the client draws it. */
export interface StepDef {
  id: string;
  label: string;
  description: string;
  /** Whether the step calls the language model: its model call is its
   * diagnostics step. Not sent. */
  model: boolean;
}

/** One edge of the pipeline; an edge to itself is a repeat. */
export interface EdgeDef {
  from: string;
  to: string;
  label?: string;
}

export interface Topology {
  steps: StepDef[];
  edges: EdgeDef[];
}

export type StepStatus = "running" | "done" | "skipped" | "failed";

/** What a step reports while it runs. */
export interface StepReport {
  summary?: string;
}

export class Trace {
  private readonly rounds = new Map<string, number>();
  private readonly modelSteps = new Set<string>();

  constructor(
    private readonly event: string,
    private readonly emit: (event: StreamEvent) => Promise<void>,
    private readonly signal: AbortSignal,
    /** The turn's steps; a model step is started by its step's own call. */
    readonly diagnostics: Diagnostics = new Diagnostics(),
  ) {}

  graph(topology: Topology): Promise<void> {
    for (const step of topology.steps) if (step.model) this.modelSteps.add(step.id);
    return this.emit({
      type: `${this.event}.graph`,
      steps: topology.steps.map(({ id, label, description }) => ({ id, label, description })),
      edges: topology.edges,
    });
  }

  /** Runs one step: `running`, then `done` with the summary the step set,
   * or `failed` when it throws (the error goes on). */
  async step<T>(id: string, run: (report: StepReport) => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    const round = (this.rounds.get(id) ?? 0) + 1;
    this.rounds.set(id, round);
    await this.emit({ type: `${this.event}.step`, id, status: "running", round });
    const report: StepReport = {};
    let status: StepStatus = "failed";
    try {
      const result = this.modelSteps.has(id)
        ? await run(report)
        : await this.diagnostics.work(id, () => run(report));
      status = "done";
      return result;
    } finally {
      if (!this.signal.aborted) {
        await this.emit({
          type: `${this.event}.step`, id, status, round,
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
}
