/**
 * Pure helpers of the steps of every kind that runs on the tool loop
 * (agents, the Studio helper): how its tool events build an answer's tool
 * calls (with client-side timing — the stream carries none), what the
 * running answer is doing, and a short description of each call.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */

import type { ToolCall } from '@/api/types'
import type { ToolEvent } from '../stream/chatStream.ts'
import type { TurnModel } from '../conversation/chatModel.ts'
import type { ModelCall } from '../diagnostics/diagnostics.ts'
import type { PartInput } from '../diagnostics/timeline.ts'

/**
 * A tool loop's answer: its insight is its tool calls, in the order they
 * were made, from the events with the kind's prefix (`agent`, `studio`).
 */
export function toolCallTurns<P extends string>(prefix: P): TurnModel<ToolEvent<P>, ToolCall[]> {
  return {
    empty: () => [],
    apply(calls, event, now) {
      if ('tool' in event && event.type === `${prefix}.tool_call`) {
        return [...calls, { callId: event.callId, tool: event.tool, args: event.args, status: 'pending', startedAt: now }]
      }
      if ('result' in event && event.type === `${prefix}.tool_result`) {
        return calls.map((call) =>
          call.callId === event.callId ? { ...call, result: event.result, status: 'completed', finishedAt: now } : call)
      }
      return calls
    },
    // Calls still running when the turn ends count as interrupted.
    end: (calls) => calls.map((call) => (call.status === 'pending' ? { ...call, status: 'interrupted' } : call)),
    hasInsight: (calls) => calls.length > 0,
    progress(calls) {
      const running = [...new Set(calls.filter((c) => c.status === 'pending').map((c) => toolLabel(c.tool)))]
      return running.length > 0 ? running.join(', ') : undefined
    },
  }
}

/** The agent's own stream events. */
export type AgentEvent = ToolEvent<'agent'>

/** An agent answer's insight is its tool calls. */
export const agentTurns = toolCallTurns('agent')

/** How long a call ran, in ms; undefined while running or when not timed. */
export function callDuration(call: ToolCall): number | undefined {
  return call.startedAt !== undefined && call.finishedAt !== undefined
    ? Math.max(0, call.finishedAt - call.startedAt)
    : undefined
}

/**
 * The time spent inside tools, in ms: the union of the calls' intervals,
 * so calls run in parallel count once and the model's thinking between
 * calls does not count. Undefined until every call finished.
 */
export function toolTime(calls: readonly ToolCall[]): number | undefined {
  if (calls.length === 0 || calls.some((c) => c.finishedAt === undefined || c.startedAt === undefined)) return undefined
  const spans = calls.map((c) => [c.startedAt!, c.finishedAt!] as const).sort((a, b) => a[0] - b[0])
  let total = 0
  let [start, end] = spans[0]!
  for (const [s, e] of spans.slice(1)) {
    if (s > end) {
      total += end - start
      start = s
    }
    end = Math.max(end, e)
  }
  return total + end - start
}

/**
 * Where a tool-loop answer's time went: model call 1, the tool calls that
 * started after it arrived (one part, its time from the first start to
 * the last end, so parallel calls count once), model call 2, … A call's
 * place comes from when its entry arrived (`ModelCall.arrivedAt`, sent
 * when it ended, before the tools it asked for run). While the answer
 * runs and no tool does, the next model call runs. Tool times are the
 * client's clock; `end` closes calls still open (the turn's end, or now).
 */
export function toolLoopParts(calls: readonly ModelCall[], tools: readonly ToolCall[], running: boolean, end: number): PartInput[] {
  const models = [...calls].sort((a, b) => a.index - b.index)
  // Group g: the tools that started after g model calls had arrived.
  const groups = new Map<number, ToolCall[]>()
  for (const tool of tools) {
    if (tool.startedAt === undefined) continue
    const g = models.filter((call) => call.arrivedAt === undefined || call.arrivedAt <= tool.startedAt!).length
    groups.set(g, [...(groups.get(g) ?? []), tool])
  }
  const parts: PartInput[] = []
  const group = (g: number) => {
    const members = groups.get(g)
    if (members === undefined) return
    const start = Math.min(...members.map((tool) => tool.startedAt!))
    const stop = Math.max(...members.map((tool) => tool.finishedAt ?? end))
    const labels = [...new Set(members.map((tool) => toolLabel(tool.tool)))]
    parts.push({
      key: `tools-${g}`,
      label: members.length === 1 ? labels[0]! : `${members.length} tool calls`,
      kind: 'work',
      state: running && members.some((tool) => tool.status === 'pending') ? 'running' : 'done',
      durationMs: Math.max(0, stop - start),
      ...(members.length > 1 && { detail: labels.join(', ') }),
    })
  }
  group(0)
  models.forEach((call, i) => {
    parts.push({ key: `model-${call.index}`, label: `Model call ${call.index}`, kind: 'model', state: call.failed ? 'failed' : 'done', durationMs: call.durationMs })
    group(i + 1)
  })
  if (running && !parts.some((part) => part.state === 'running')) {
    const index = (models.at(-1)?.index ?? 0) + 1
    parts.push({ key: `model-${index}`, label: `Model call ${index}`, kind: 'model', state: 'running' })
  }
  return parts
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The error a tool answered with (`{error}`, its text or `{code, message}`), if any. */
export function toolError(call: ToolCall): string | null {
  const result = call.result
  if (call.status !== 'completed' || !isRecord(result) || Object.keys(result).length !== 1) return null
  const error = result.error
  if (typeof error === 'string') return error
  return isRecord(error) && typeof error.message === 'string' ? error.message : null
}

/**
 * What a completed call's result left out: the sentence of its `more`
 * field, present only when the tool bounded its answer; null otherwise,
 * and for a result that is an entity itself.
 */
export function toolResultMore(call: ToolCall): string | null {
  const result = call.result
  if (call.status !== 'completed' || !isRecord(result)) return null
  // An entity carries no note: a `more` there is one of its own properties.
  if (typeof result._id === 'string') return null
  return typeof result.more === 'string' && result.more.trim() !== '' ? result.more : null
}

/** How many calls an answer made, and how many of them answered with an error. */
export function toolCallCounts(calls: readonly ToolCall[]): { calls: number; errors: number } {
  return { calls: calls.length, errors: calls.filter((call) => toolError(call) !== null).length }
}

const TOOL_LABELS: Record<string, string> = {
  get_schema: 'Read the schema',
  list_entities: 'List entities',
  get_entity: 'Get entity',
  get_document: 'Read document',
  list_relations: 'List relations',
  get_neighbors: 'Get neighbours',
  search: 'Search',
  search_documents: 'Search documents',
  execute_query: 'Run OQL query',
  list_saved_queries: 'List saved queries',
  run_saved_query: 'Run saved query',
  search_saved_queries: 'Search saved queries',
  list_lenses: 'List lenses',
  list_search_indices: 'List search indices',
  validate_schema: 'Validate the schema',
  validate_lens: 'Validate a lens',
  propose_schema_change: 'Check a proposal',
}

/** A readable name of a tool; unknown tools keep their key. */
export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : typeof value === 'number' ? String(value) : undefined

/** One line of what a call asked for, from its arguments; undefined when nothing tells. */
export function toolCallSummary(call: ToolCall): string | undefined {
  const a = call.args
  switch (call.tool) {
    case 'search':
    case 'search_documents':
    case 'search_saved_queries': {
      const query = text(a.query)
      // The scope: types or documents, whichever was named.
      const scope = [a.types, a.documents].find((keys) => Array.isArray(keys) && keys.length > 0)
      return query === undefined ? undefined : `“${query}”${scope ? ` in ${(scope as unknown[]).join(', ')}` : ''}`
    }
    case 'execute_query':
      return text(a.query)?.replace(/\s+/g, ' ')
    case 'run_saved_query':
      return text(a.query_key)
    case 'list_entities': {
      const type = text(a.entity_type_key)
      const search = text(a.search)
      const filters = a.filters !== null && typeof a.filters === 'object' ? Object.entries(a.filters as Record<string, unknown>) : []
      const parts = [type, search && `“${search}”`, ...filters.map(([k, v]) => `${k} = ${String(v)}`)].filter(Boolean)
      return parts.length > 0 ? parts.join(' · ') : undefined
    }
    case 'get_entity':
    case 'get_neighbors': {
      const type = text(a.entity_type_key)
      const id = text(a.entity_id)
      const direction = call.tool === 'get_neighbors' ? text(a.direction) : undefined
      return [type, id, direction].filter(Boolean).join(' · ') || undefined
    }
    case 'get_document':
      return [text(a.entity_type_key), text(a.entity_id), text(a.property_key)].filter(Boolean).join(' · ') || undefined
    case 'list_relations':
      return text(a.relation_type_key)
    case 'validate_lens':
      return text(a.lens_key)
    default:
      return undefined
  }
}
