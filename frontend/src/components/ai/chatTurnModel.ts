/**
 * Pure helpers for the agent chat: how stream events build an assistant
 * turn (with client-side timing — the stream carries none), which turn the
 * tool-call panel shows, and a short description of each tool call.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */

import type { ChatEvent } from '@/api/chatStream'
import type { ToolCall } from '@/api/types'
import type { StoredChatMessage } from './chatStore.ts'

/** A new, pending assistant turn, started at `now`. */
export function pendingTurn(id: string, now: number): StoredChatMessage {
  return { id, role: 'assistant', content: '', status: 'pending', toolCalls: [], startedAt: now }
}

/** The turn after one stream event, `now` the client clock in ms. */
export function applyChatEvent(turn: StoredChatMessage, event: ChatEvent, now: number): StoredChatMessage {
  switch (event.type) {
    case 'tool_call':
      return {
        ...turn,
        toolCalls: [
          ...(turn.toolCalls ?? []),
          { callId: event.callId, tool: event.tool, args: event.args, status: 'pending', startedAt: now },
        ],
      }
    case 'tool_result':
      return {
        ...turn,
        toolCalls: turn.toolCalls?.map((call) =>
          call.callId === event.callId
            ? { ...call, result: event.result, status: 'completed', finishedAt: now }
            : call,
        ),
      }
    case 'final':
      return { ...turn, content: event.reply, status: 'completed', finishedAt: now }
    case 'error':
      return failTurn(turn, event.error.message, now)
  }
}

/** The turn failed at `now`: calls still running count as interrupted. */
export function failTurn(turn: StoredChatMessage, message: string, now: number): StoredChatMessage {
  return {
    ...turn,
    status: 'failed',
    error: message,
    finishedAt: now,
    toolCalls: turn.toolCalls?.map((call) =>
      call.status === 'pending' ? { ...call, status: 'interrupted' } : call,
    ),
  }
}

/** The assistant turn the panel shows: the chosen one, else the latest with tool calls. */
export function inspectedTurn(
  messages: readonly StoredChatMessage[],
  selectedId: string | null,
): StoredChatMessage | undefined {
  const withCalls = messages.filter((m) => m.role === 'assistant' && m.id !== undefined && (m.toolCalls?.length ?? 0) > 0)
  return withCalls.find((m) => m.id === selectedId) ?? withCalls.at(-1)
}

/** The user message a turn answers. */
export function questionOf(messages: readonly StoredChatMessage[], turn: StoredChatMessage): string | undefined {
  const at = messages.indexOf(turn)
  for (let i = at - 1; i >= 0; i -= 1) if (messages[i]!.role === 'user') return messages[i]!.content
  return undefined
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

/** How long the answer took, from sending to the reply, in ms. */
export function turnDuration(turn: StoredChatMessage): number | undefined {
  return turn.startedAt !== undefined && turn.finishedAt !== undefined ? turn.finishedAt - turn.startedAt : undefined
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

/** `412 ms`, `2.4 s`. */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}
