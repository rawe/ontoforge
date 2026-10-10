/**
 * Pure helpers of the agent chat: how the agent's tool events build an
 * answer's tool calls (with client-side timing — the stream carries none),
 * what the running answer is doing, and a short description of each call.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */

import type { ChatEvent, SharedEvent } from '@/api/chatStream'
import type { ToolCall } from '@/api/types'
import type { TurnModel } from '../chat/chatModel.ts'

/** The agent's own stream events. */
export type AgentEvent = Exclude<ChatEvent, SharedEvent>

/** An agent answer's insight is its tool calls, in the order they were made. */
export const agentTurns: TurnModel<AgentEvent, ToolCall[]> = {
  empty: () => [],
  apply(calls, event, now) {
    switch (event.type) {
      case 'agent.tool_call':
        return [...calls, { callId: event.callId, tool: event.tool, args: event.args, status: 'pending', startedAt: now }]
      case 'agent.tool_result':
        return calls.map((call) =>
          call.callId === event.callId ? { ...call, result: event.result, status: 'completed', finishedAt: now } : call)
    }
  },
  // Calls still running when the turn ends count as interrupted.
  end: (calls) => calls.map((call) => (call.status === 'pending' ? { ...call, status: 'interrupted' } : call)),
  hasInsight: (calls) => calls.length > 0,
  progress(calls) {
    const running = [...new Set(calls.filter((c) => c.status === 'pending').map((c) => toolLabel(c.tool)))]
    return running.length > 0 ? running.join(', ') : undefined
  },
}

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

/** The error a tool answered with (`{error}`), if any. */
export function toolError(call: ToolCall): string | null {
  const result = call.result
  if (call.status !== 'completed' || typeof result !== 'object' || result === null || Array.isArray(result)) return null
  const keys = Object.keys(result)
  const error = (result as Record<string, unknown>).error
  return keys.length === 1 && typeof error === 'string' ? error : null
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
      const type = text(a.entity_type_key)
      return query === undefined ? undefined : `“${query}”${type ? ` in ${type}` : ''}`
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
    default:
      return undefined
  }
}
