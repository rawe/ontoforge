/**
 * Pure turn handling of every graph assistant kind: its events fold into
 * one answer's insight — the pipeline, each step's runs, the entity cards
 * and links, the summary — and the answer's `[E2]` / `[E2, E5]` citations
 * split into text and card references.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */
import type { TurnModel } from '../chat/chatModel.ts'
import {
  isGraphEvent,
  type EntityCard,
  type EntityLink,
  type GraphEvent,
  type GraphSummary,
  type GraphTopology,
  type StepStatus,
} from './graphEvents.ts'

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
  /** Cards in discovery order; a later card with the same ref replaces the earlier one in place. */
  entities: EntityCard[]
  /** Unique by from + type + to. */
  links: EntityLink[]
  summary: GraphSummary | null
}

const linkKey = (link: EntityLink) => `${link.from}\u0000${link.type ?? link.label ?? ''}\u0000${link.to}`

/** Replace items with the same key in place, append new ones. */
function upsert<T>(current: readonly T[], next: readonly T[], key: (item: T) => string): T[] {
  const result = [...current]
  const at = new Map(result.map((item, i) => [key(item), i]))
  for (const item of next) {
    const i = at.get(key(item))
    if (i === undefined) {
      at.set(key(item), result.length)
      result.push(item)
    } else {
      result[i] = item
    }
  }
  return result
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
  empty: () => ({ graph: null, steps: [], entities: [], links: [], summary: null }),
  apply(insight, event) {
    if (isGraphEvent(event, 'graph')) return { ...insight, graph: { steps: event.steps, edges: event.edges } }
    if (isGraphEvent(event, 'step')) return { ...insight, steps: applyStep(insight.steps, event) }
    if (isGraphEvent(event, 'entities')) {
      return {
        ...insight,
        entities: upsert(insight.entities, event.entities, (card) => card.ref),
        links: upsert(insight.links, event.links ?? [], linkKey),
      }
    }
    if (isGraphEvent(event, 'summary')) return { ...insight, summary: event }
    return insight
  },
  end: (insight) => ({
    ...insight,
    steps: insight.steps.map((s) => (s.status === 'running' ? { ...s, status: 'interrupted' } : s)),
  }),
  hasInsight: (insight) => insight.graph !== null || insight.steps.length > 0 || insight.entities.length > 0,
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

/* ---------------------------------- cards ---------------------------------- */

/** The roles every graph kind may send, in the order the sidebar groups them. */
export const ROLE_ORDER = ['anchor', 'focus', 'result', 'flagged', 'reached'] as const

const ROLES: Record<string, { title: string; hint: string; color: string }> = {
  anchor: { title: 'Anchors', hint: 'Named in the question', color: 'var(--primary)' },
  focus: { title: 'From the previous answer', hint: 'Where this follow-up starts', color: 'var(--tc-amber)' },
  result: { title: 'Results', hint: 'Returned by the query', color: 'var(--tc-emerald)' },
  flagged: { title: 'Flagged', hint: 'Found by a check', color: 'var(--destructive)' },
  reached: { title: 'Reached', hint: 'Found by following relations', color: 'var(--muted-foreground)' },
}

/** A role's group title, its one-line meaning and its color (a CSS value); an unknown role shows as sent. */
export const roleInfo = (role: string) => ROLES[role] ?? { title: role, hint: '', color: 'var(--muted-foreground)' }

/** Cards grouped by role: known roles in `ROLE_ORDER`, others after them as they first appear. */
export function groupByRole(entities: readonly EntityCard[]): { role: string; cards: EntityCard[] }[] {
  const groups = new Map<string, EntityCard[]>()
  for (const card of entities) groups.set(card.role, [...(groups.get(card.role) ?? []), card])
  const rank = (role: string) => {
    const i = (ROLE_ORDER as readonly string[]).indexOf(role)
    return i === -1 ? ROLE_ORDER.length : i
  }
  return [...groups.keys()].sort((a, b) => rank(a) - rank(b)).map((role) => ({ role, cards: groups.get(role)! }))
}

/* -------------------------------- citations -------------------------------- */

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'cite'; ref: string; card: EntityCard }

const CITATION = /\[\s*(E\d+(?:\s*,\s*E\d+)*)\s*\]/g

/**
 * The answer text split at its citations: `[E2]` and `[E2, E5]` become one
 * `cite` segment per evidence card. A ref that is not an evidence card of
 * this turn stays text (`[E9]`); a group without any stays as written.
 */
export function citations(text: string, entities: readonly EntityCard[]): Segment[] {
  const evidence = new Map(entities.filter((card) => card.evidence === true).map((card) => [card.ref, card]))
  const segments: Segment[] = []
  const push = (value: string) => {
    if (value === '') return
    const last = segments.at(-1)
    if (last?.kind === 'text') last.text += value
    else segments.push({ kind: 'text', text: value })
  }
  let at = 0
  for (const match of text.matchAll(CITATION)) {
    const refs = match[1]!.split(',').map((ref) => ref.trim())
    if (!refs.some((ref) => evidence.has(ref))) continue
    push(text.slice(at, match.index))
    for (const ref of refs) {
      const card = evidence.get(ref)
      if (card === undefined) push(`[${ref}]`)
      else segments.push({ kind: 'cite', ref, card })
    }
    at = match.index + match[0].length
  }
  push(text.slice(at))
  return segments
}
