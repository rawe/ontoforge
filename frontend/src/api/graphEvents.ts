/**
 * The stream events every graph assistant kind sends, namespaced by the
 * kind (`navigator.graph`, `navigator.step`, …): its pipeline once, the
 * live trace of its steps and a summary before `final`. One reader checks
 * them for any kind; the entities it found come as the shared `entities`
 * event (`entities.ts`).
 *
 * No React, no I/O — unit-tested with `node --test`.
 */
import { optional, record, text } from './checks.ts'
import type { KindReader } from './chatStream.ts'

/** One step of a kind's pipeline, as drawn. */
export interface GraphStep {
  id: string
  label: string
  description: string
  /** The step calls a language model. */
  model?: boolean
}
/** A transition of the pipeline; `from === to` is a repeat (a loop). */
export interface GraphEdge {
  from: string
  to: string
  label?: string
}
export interface GraphTopology {
  steps: GraphStep[]
  edges: GraphEdge[]
}

export type StepStatus = 'running' | 'done' | 'skipped' | 'failed'

export interface GraphSummary {
  modelCalls?: number
  durationMs?: number
  entities?: number
  evidence?: number
  hops?: number
  timings?: Record<string, number>
}

export type GraphTopologyEvent = { type: string } & GraphTopology
export interface GraphStepEvent {
  type: string
  id: string
  status: StepStatus
  /** Counts repeats of the step, from 1. */
  round?: number
  durationMs?: number
  /** Plain human text: what the step did. */
  summary?: string
}
export type GraphSummaryEvent = { type: string } & GraphSummary

/** A graph kind's own events; tell them apart with `isGraphEvent`. */
export type GraphEvent = GraphTopologyEvent | GraphStepEvent | GraphSummaryEvent

interface GraphEventMap {
  graph: GraphTopologyEvent
  step: GraphStepEvent
  summary: GraphSummaryEvent
}
export type GraphEventName = keyof GraphEventMap

/** Whether the event is the kind's `<kind>.<name>` event. */
export const isGraphEvent = <N extends GraphEventName>(event: GraphEvent, name: N): event is GraphEventMap[N] =>
  event.type.slice(event.type.indexOf('.') + 1) === name

/* --------------------------------- checks ---------------------------------- */

const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const STATUSES: ReadonlySet<unknown> = new Set(['running', 'done', 'skipped', 'failed'])

const validTopology = (e: Record<string, unknown>) =>
  Array.isArray(e.steps) && e.steps.every((s) => record(s) && text(s.id) && text(s.label) &&
    optional(s.description, text) && optional(s.model, (v) => typeof v === 'boolean')) &&
  Array.isArray(e.edges) && e.edges.every((x) => record(x) && text(x.from) && text(x.to) && optional(x.label, text))

const validStep = (e: Record<string, unknown>) =>
  text(e.id) && STATUSES.has(e.status) && optional(e.round, (v) => number(v) && v >= 1) &&
  optional(e.durationMs, number) && optional(e.summary, text)

const validSummary = (e: Record<string, unknown>) =>
  ['modelCalls', 'durationMs', 'entities', 'evidence', 'hops'].every((key) => optional(e[key], number)) &&
  optional(e.timings, (t) => record(t) && Object.values(t).every(number))

const CHECKS: Record<GraphEventName, (e: Record<string, unknown>) => boolean> = {
  graph: validTopology, step: validStep, summary: validSummary,
}

/**
 * The reader of one graph kind's events (`<kind>.graph|step|summary`),
 * checked before they reach the UI. Other dotted events — another kind's,
 * or one of this kind this client does not know — are ignored; a malformed
 * one throws.
 */
export function graphKindReader(kind: string): KindReader<GraphEvent> {
  const prefix = `${kind}.`
  return {
    parse(e) {
      if (typeof e.type !== 'string' || !e.type.includes('.')) throw new Error('Unknown chat event')
      if (!e.type.startsWith(prefix)) return null
      const name = e.type.slice(prefix.length)
      if (!Object.hasOwn(CHECKS, name)) return null
      if (!CHECKS[name as GraphEventName](e)) throw new Error(`Invalid ${e.type} event`)
      return e as unknown as GraphEvent
    },
  }
}
