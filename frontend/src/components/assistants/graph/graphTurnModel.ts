/**
 * Pure turn handling of every graph assistant kind: its events fold into
 * one answer's insight — the pipeline, each step's runs, the summary. The
 * entities it met are the turn's own (`chatModel.ts`).
 *
 * No React, no I/O — unit-tested with `node --test`.
 */
import {
  isGraphEvent,
  type GraphEvent,
  type GraphSummary,
  type GraphTopology,
  type StepStatus,
} from '../../../api/graphEvents.ts'
import type { TurnModel } from '../chat/chatModel.ts'

/** A run that was still going when the turn failed or was stopped. */
export type RunStatus = StepStatus | 'interrupted'

/** One run of a step: the step once, or once per round when it repeats. */
export interface StepRun {
  id: string
  round: number
  status: RunStatus
  summary?: string
  durationMs?: number
}

/** What a graph kind reported about one answer. */
export interface GraphInsight {
  /** The pipeline; null until the kind sent it. */
  graph: GraphTopology | null
  /** Every run, by step id + round, in the order they started. */
  steps: StepRun[]
  summary: GraphSummary | null
}

function applyStep(steps: readonly StepRun[], event: { id: string; status: StepStatus; round?: number; summary?: string; durationMs?: number }): StepRun[] {
  const round = event.round ?? 1
  const i = steps.findIndex((s) => s.id === event.id && s.round === round)
  const run: StepRun = {
    ...(i === -1 ? { id: event.id, round } : steps[i]),
    status: event.status,
    ...(event.summary !== undefined && { summary: event.summary }),
    ...(event.durationMs !== undefined && { durationMs: event.durationMs }),
  }
  return i === -1 ? [...steps, run] : steps.map((s, j) => (j === i ? run : s))
}

/** A step's display label from the pipeline, else its id. */
export const stepLabel = (insight: Pick<GraphInsight, 'graph'>, id: string) =>
  insight.graph?.steps.find((s) => s.id === id)?.label ?? id

/** How every graph kind's events build an answer's insight. */
export const graphTurns: TurnModel<GraphEvent, GraphInsight> = {
  empty: () => ({ graph: null, steps: [], summary: null }),
  apply(insight, event) {
    if (isGraphEvent(event, 'graph')) return { ...insight, graph: { steps: event.steps, edges: event.edges } }
    if (isGraphEvent(event, 'step')) return { ...insight, steps: applyStep(insight.steps, event) }
    if (isGraphEvent(event, 'summary')) return { ...insight, summary: event }
    return insight
  },
  end: (insight) => ({
    ...insight,
    steps: insight.steps.map((s) => (s.status === 'running' ? { ...s, status: 'interrupted' } : s)),
  }),
  hasInsight: (insight) => insight.graph !== null || insight.steps.length > 0,
  progress(insight) {
    const running = insight.steps.filter((s) => s.status === 'running')
    if (running.length === 0) return undefined
    return running.map((s) => (s.round > 1 ? `${stepLabel(insight, s.id)} · round ${s.round}` : stepLabel(insight, s.id))).join(', ')
  },
}

/** A step's state in the pipeline: its latest run's, else not started — or `not-run` once the turn ended. */
export function stepState(insight: Pick<GraphInsight, 'steps'>, id: string, ended: boolean): RunStatus | 'waiting' | 'not-run' {
  const runs = insight.steps.filter((s) => s.id === id)
  return runs.at(-1)?.status ?? (ended ? 'not-run' : 'waiting')
}
