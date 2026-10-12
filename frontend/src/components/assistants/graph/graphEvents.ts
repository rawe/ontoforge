/**
 * The stream events every graph assistant kind sends, namespaced by the
 * kind (`navigator.graph`, `navigator.step`, …): its pipeline once, the
 * live trace of its steps, the entity cards and links it found (upserted),
 * and a summary before `final`. One reader checks them for any kind.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */
import type { KindReader } from '@/api/chatStream'

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

/** An entity the turn found, as one card; `ref` (`E1`, `E2`, …) is what the answer cites. */
export interface EntityCard {
  ref: string
  id: string
  type: string
  typeName: string
  label: string
  /** `anchor` (named in the question), `reached` (walked to), `focus` (from the previous answer); kinds may add more. */
  role: string
  /** Distance from the nearest anchor; 0 for anchors and focus. */
  hop?: number
  reason?: string
  fields?: { name: string; value: string }[]
  /** Handed to the answer model — only evidence can be cited. */
  evidence?: boolean
}
/** A relation between two cards, directed as stored. */
export interface EntityLink {
  from: string
  to: string
  type?: string
  label?: string
}
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
export interface GraphEntitiesEvent {
  type: string
  entities: EntityCard[]
  links?: EntityLink[]
}
export type GraphSummaryEvent = { type: string } & GraphSummary

/** A graph kind's own events; tell them apart with `isGraphEvent`. */
export type GraphEvent = GraphTopologyEvent | GraphStepEvent | GraphEntitiesEvent | GraphSummaryEvent

interface GraphEventMap {
  graph: GraphTopologyEvent
  step: GraphStepEvent
  entities: GraphEntitiesEvent
  summary: GraphSummaryEvent
}
export type GraphEventName = keyof GraphEventMap

/** Whether the event is the kind's `<kind>.<name>` event. */
export const isGraphEvent = <N extends GraphEventName>(event: GraphEvent, name: N): event is GraphEventMap[N] =>
  event.type.slice(event.type.indexOf('.') + 1) === name

/* --------------------------------- checks ---------------------------------- */

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'
const optional = (value: unknown, check: (v: unknown) => boolean) => value === undefined || check(value)
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const STATUSES: ReadonlySet<unknown> = new Set(['running', 'done', 'skipped', 'failed'])

const validTopology = (e: Record<string, unknown>) =>
  Array.isArray(e.steps) && e.steps.every((s) => record(s) && text(s.id) && text(s.label) &&
    optional(s.description, text) && optional(s.model, (v) => typeof v === 'boolean')) &&
  Array.isArray(e.edges) && e.edges.every((x) => record(x) && text(x.from) && text(x.to) && optional(x.label, text))

const validStep = (e: Record<string, unknown>) =>
  text(e.id) && STATUSES.has(e.status) && optional(e.round, (v) => number(v) && v >= 1) &&
  optional(e.durationMs, number) && optional(e.summary, text)

const validCard = (c: unknown) => record(c) &&
  text(c.ref) && text(c.id) && text(c.type) && text(c.typeName) && text(c.label) && text(c.role) &&
  optional(c.hop, number) && optional(c.reason, text) && optional(c.evidence, (v) => typeof v === 'boolean') &&
  optional(c.fields, (f) => Array.isArray(f) && f.every((x) => record(x) && text(x.name) && text(x.value)))

const validEntities = (e: Record<string, unknown>) =>
  Array.isArray(e.entities) && e.entities.every(validCard) &&
  optional(e.links, (l) => Array.isArray(l) && l.every((x) => record(x) && text(x.from) && text(x.to) && optional(x.type, text) && optional(x.label, text)))

const validSummary = (e: Record<string, unknown>) =>
  ['modelCalls', 'durationMs', 'entities', 'evidence', 'hops'].every((key) => optional(e[key], number)) &&
  optional(e.timings, (t) => record(t) && Object.values(t).every(number))

const CHECKS: Record<GraphEventName, (e: Record<string, unknown>) => boolean> = {
  graph: validTopology, step: validStep, entities: validEntities, summary: validSummary,
}

/**
 * The reader of one graph kind's events (`<kind>.graph|step|entities|summary`),
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
