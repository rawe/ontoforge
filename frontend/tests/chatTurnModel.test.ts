import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyChatEvent,
  callDuration,
  failTurn,
  formatDuration,
  inspectedTurn,
  pendingTurn,
  questionOf,
  toolCallSummary,
  toolError,
  toolTime,
  turnDuration,
} from '../src/components/ai/chatTurnModel.ts'
import type { StoredChatMessage } from '../src/components/ai/chatStore.ts'
import type { ToolCall } from '../src/api/types.ts'

test('applyChatEvent times calls and matches results out of order by callId', () => {
  let turn = pendingTurn('t1', 0)
  turn = applyChatEvent(turn, { type: 'tool_call', callId: 'a', tool: 'get_entity', args: { entity_id: 'x' } }, 100)
  turn = applyChatEvent(turn, { type: 'tool_call', callId: 'b', tool: 'search', args: { query: 'q' } }, 110)
  turn = applyChatEvent(turn, { type: 'tool_result', callId: 'b', result: { hits: [] } }, 150)
  turn = applyChatEvent(turn, { type: 'tool_result', callId: 'a', result: { _id: 'x' } }, 400)
  turn = applyChatEvent(turn, { type: 'final', reply: 'done' }, 410)
  assert.equal(turn.status, 'completed')
  assert.equal(turn.content, 'done')
  assert.deepEqual(turn.toolCalls!.map((c) => [c.callId, c.status, callDuration(c)]), [['a', 'completed', 300], ['b', 'completed', 40]])
  assert.equal(toolTime(turn.toolCalls!), 300)
  assert.equal(turnDuration(turn), 410)
})

test('a failed turn interrupts running calls and has no span', () => {
  let turn = applyChatEvent(pendingTurn('t', 0), { type: 'tool_call', callId: 'a', tool: 'search', args: {} }, 1)
  turn = failTurn(turn, 'boom', 5)
  assert.equal(turn.status, 'failed')
  assert.equal(turn.toolCalls![0]!.status, 'interrupted')
  assert.equal(toolTime(turn.toolCalls!), undefined)
  assert.equal(turnDuration(turn), 5)
  assert.equal(applyChatEvent(pendingTurn('t', 0), { type: 'error', error: { code: 'X', message: 'm' } }, 1).error, 'm')
})

test('inspectedTurn picks the chosen turn, else the latest with tool calls; questionOf finds its question', () => {
  const call: ToolCall = { callId: 'c', tool: 'search', args: {}, status: 'completed' }
  const messages: StoredChatMessage[] = [
    { role: 'user', content: 'first' },
    { id: 'a', role: 'assistant', content: 'A', toolCalls: [call] },
    { role: 'user', content: 'second' },
    { id: 'b', role: 'assistant', content: 'B', toolCalls: [call] },
    { role: 'user', content: 'third' },
    { id: 'c', role: 'assistant', content: 'C', toolCalls: [] },
    { role: 'assistant', content: 'restored, no id' },
  ]
  assert.equal(inspectedTurn(messages, null)?.id, 'b')
  assert.equal(inspectedTurn(messages, 'a')?.id, 'a')
  assert.equal(inspectedTurn(messages, 'c')?.id, 'b')
  assert.equal(questionOf(messages, messages[3]!), 'second')
  assert.equal(inspectedTurn([], null), undefined)
})

test('toolError reads an {error} result only', () => {
  const call = (result: unknown, status: ToolCall['status'] = 'completed'): ToolCall => ({ callId: 'c', tool: 't', args: {}, result, status })
  assert.equal(toolError(call({ error: 'not found' })), 'not found')
  assert.equal(toolError(call({ error: 'x', items: [] })), null)
  assert.equal(toolError(call('text')), null)
  assert.equal(toolError(call({ error: 'x' }, 'pending')), null)
})

test('toolCallSummary says what a call asked for', () => {
  const summary = (tool: string, args: Record<string, unknown>) => toolCallSummary({ callId: 'c', tool, args, status: 'pending' })
  assert.equal(summary('search', { query: 'CTO', entity_type_key: 'person' }), '“CTO” in person')
  assert.equal(summary('execute_query', { query: 'MATCH (p:person)\n  RETURN p' }), 'MATCH (p:person) RETURN p')
  assert.equal(summary('list_entities', { entity_type_key: 'person', search: null, filters: { city: 'Berlin' } }), 'person · city = Berlin')
  assert.equal(summary('get_neighbors', { entity_type_key: 'person', entity_id: 'p1', direction: 'outgoing' }), 'person · p1 · outgoing')
  assert.equal(summary('get_schema', {}), undefined)
})

test('formatDuration', () => {
  assert.equal(formatDuration(412.4), '412 ms')
  assert.equal(formatDuration(2440), '2.4 s')
})

test('toolTime counts parallel calls once and leaves out the time between calls', () => {
  const call = (startedAt: number, finishedAt: number): ToolCall => ({ callId: `${startedAt}`, tool: 't', args: {}, status: 'completed', startedAt, finishedAt })
  assert.equal(toolTime([call(0, 10), call(1500, 1520)]), 30)
  assert.equal(toolTime([call(0, 20), call(5, 19)]), 20)
  assert.equal(toolTime([call(0, 10), { callId: 'p', tool: 't', args: {}, status: 'pending', startedAt: 3 }]), undefined)
})
