import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STOPPED_TEXT,
  applyEvent,
  elapsedSeconds,
  endText,
  failTurn,
  formatDuration,
  inspectedTurn,
  pendingTurn,
  restoredTurns,
  stopTurn,
  turnDuration,
  type Turn,
  type TurnModel,
} from '../src/components/assistants/chat/chatModel.ts'
import {
  agentTurns,
  callDuration,
  toolCallSummary,
  toolError,
  toolTime,
} from '../src/components/assistants/agents/toolCallModel.ts'
import { retrieverTurns, type RetrieverInsight } from '../src/components/assistants/retrievers/retrieverModel.ts'
import type { ToolCall } from '../src/api/types.ts'

const agentTurn = (now = 0) => pendingTurn('t', 'q', agentTurns.empty(), now)
const retrieverTurn = (now = 0) => pendingTurn('t', 'q', retrieverTurns.empty(), now)

/* --------------------------------- shared ---------------------------------- */

test('shared events build the answer for every kind: deltas append, final replaces and ends', () => {
  const flow = <E extends { type: string }, I>(model: TurnModel<E, I>) => {
    const turn = pendingTurn('t', 'q', model.empty(), 0)
    let t = applyEvent(model, turn, { type: 'thread', threadId: 'th' }, 1)
    assert.equal(t, turn)
    t = applyEvent(model, t, { type: 'delta', text: 'Hel' }, 2)
    t = applyEvent(model, t, { type: 'delta', text: 'lo' }, 3)
    assert.equal(t.reply, 'Hello')
    assert.equal(t.status, 'pending')
    t = applyEvent(model, t, { type: 'final', reply: 'Hello' }, 10)
    assert.equal(t.status, 'complete')
    assert.equal(turnDuration(t), 10)
    assert.equal(endText(t), null)
    assert.equal(model.hasInsight(t.insight), false)
  }
  flow(agentTurns)
  flow(retrieverTurns)
})

test('an error event fails the turn and keeps the partial answer', () => {
  let t = applyEvent(retrieverTurns, retrieverTurn(), { type: 'delta', text: 'part' }, 1)
  t = applyEvent(retrieverTurns, t, { type: 'error', error: { code: 'X', message: 'model down' } }, 5)
  assert.equal(t.status, 'failed')
  assert.equal(t.reply, 'part')
  assert.equal(endText(t), 'Incomplete: model down')
  assert.equal(turnDuration(t), 5)
})

test('a stopped turn says so, without a reason', () => {
  const t = stopTurn(retrieverTurns, retrieverTurn(), 4)
  assert.equal(t.status, 'failed')
  assert.equal(t.stopped, true)
  assert.equal(t.error, undefined)
  assert.equal(endText(t), STOPPED_TEXT)
  assert.equal(endText(failTurn(retrieverTurns, retrieverTurn(), 'Thread is busy', 4)), 'Incomplete: Thread is busy')
})

test('restoredTurns pairs each question with the answer after it', () => {
  let n = 0
  const turns = restoredTurns([
    { role: 'assistant', content: 'orphan' },
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'A' },
    { role: 'user', content: 'two' },
  ], agentTurns.empty, () => `r${++n}`)
  assert.deepEqual(turns.map((t) => [t.id, t.question, t.reply, t.status, t.restored, t.insight]), [
    ['r1', 'one', 'A', 'complete', true, []],
    ['r2', 'two', '', 'complete', true, []],
  ])
})

test('inspectedTurn picks the chosen turn, else the latest with insight', () => {
  const call: ToolCall = { callId: 'c', tool: 'search', args: {}, status: 'completed' }
  const turn = (id: string, insight: ToolCall[]): Turn<ToolCall[]> => ({ id, question: id, reply: '', status: 'complete', insight })
  const turns = [turn('a', [call]), turn('b', [call]), turn('c', [])]
  assert.equal(inspectedTurn(turns, null, agentTurns.hasInsight)?.id, 'b')
  assert.equal(inspectedTurn(turns, 'a', agentTurns.hasInsight)?.id, 'a')
  assert.equal(inspectedTurn(turns, 'c', agentTurns.hasInsight)?.id, 'b')
  assert.equal(inspectedTurn([], null, agentTurns.hasInsight), undefined)
})

test('formatDuration and elapsed seconds', () => {
  assert.equal(formatDuration(412.4), '412 ms')
  assert.equal(formatDuration(2440), '2.4 s')
  assert.equal(elapsedSeconds(1000, 13999), 12)
  assert.equal(elapsedSeconds(1000, 500), 0)
})

/* ---------------------------------- agent ---------------------------------- */

test('agent: tool events are timed and matched out of order by callId; the running tool is the live detail', () => {
  let turn = agentTurn()
  turn = applyEvent(agentTurns, turn, { type: 'agent.tool_call', callId: 'a', tool: 'get_entity', args: { entity_id: 'x' } }, 100)
  turn = applyEvent(agentTurns, turn, { type: 'agent.tool_call', callId: 'b', tool: 'search', args: { query: 'q' } }, 110)
  assert.equal(agentTurns.progress(turn.insight), 'Get entity, Search')
  turn = applyEvent(agentTurns, turn, { type: 'agent.tool_result', callId: 'b', result: { hits: [] } }, 150)
  assert.equal(agentTurns.progress(turn.insight), 'Get entity')
  turn = applyEvent(agentTurns, turn, { type: 'agent.tool_result', callId: 'a', result: { _id: 'x' } }, 400)
  assert.equal(agentTurns.progress(turn.insight), undefined)
  turn = applyEvent(agentTurns, turn, { type: 'final', reply: 'done' }, 410)
  assert.equal(turn.status, 'complete')
  assert.equal(turn.reply, 'done')
  assert.deepEqual(turn.insight.map((c) => [c.callId, c.status, callDuration(c)]), [['a', 'completed', 300], ['b', 'completed', 40]])
  assert.equal(toolTime(turn.insight), 300)
  assert.equal(turnDuration(turn), 410)
  assert.equal(agentTurns.hasInsight(turn.insight), true)
  assert.equal(agentTurns.hasInsight(agentTurns.empty()), false)
})

test('agent: a failed or stopped turn interrupts running calls', () => {
  const turn = applyEvent(agentTurns, agentTurn(), { type: 'agent.tool_call', callId: 'a', tool: 'search', args: {} }, 1)
  for (const ended of [failTurn(agentTurns, turn, 'boom', 5), stopTurn(agentTurns, turn, 5), applyEvent(agentTurns, turn, { type: 'error', error: { code: 'X', message: 'm' } }, 5)]) {
    assert.equal(ended.status, 'failed')
    assert.equal(ended.insight[0]!.status, 'interrupted')
    assert.equal(toolTime(ended.insight), undefined)
  }
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

test('toolTime counts parallel calls once and leaves out the time between calls', () => {
  const call = (startedAt: number, finishedAt: number): ToolCall => ({ callId: `${startedAt}`, tool: 't', args: {}, status: 'completed', startedAt, finishedAt })
  assert.equal(toolTime([call(0, 10), call(1500, 1520)]), 30)
  assert.equal(toolTime([call(0, 20), call(5, 19)]), 20)
  assert.equal(toolTime([call(0, 10), { callId: 'p', tool: 't', args: {}, status: 'pending', startedAt: 3 }]), undefined)
})

/* -------------------------------- retriever -------------------------------- */

test('retriever: the started phase is the live detail; diagnostics merge as they arrive', () => {
  let turn: Turn<RetrieverInsight> = retrieverTurn()
  assert.equal(retrieverTurns.progress(turn.insight), undefined)
  assert.equal(retrieverTurns.hasInsight(turn.insight), false)
  turn = applyEvent(retrieverTurns, turn, { type: 'retriever.phase', phase: 'plan', status: 'start' }, 1)
  assert.equal(retrieverTurns.progress(turn.insight), 'Plan question')
  turn = applyEvent(retrieverTurns, turn, { type: 'retriever.diagnostics', timings: { plan: 1200 }, limitations: ['a'] }, 2)
  turn = applyEvent(retrieverTurns, turn, { type: 'retriever.phase', phase: 'plan', status: 'end', durationMs: 1200 }, 3)
  assert.equal(retrieverTurns.progress(turn.insight), 'Plan question')
  turn = applyEvent(retrieverTurns, turn, { type: 'retriever.phase', phase: 'retrieve', status: 'start' }, 4)
  assert.equal(retrieverTurns.progress(turn.insight), 'Search indices')
  turn = applyEvent(retrieverTurns, turn, { type: 'retriever.diagnostics', timings: { retrieve: 100, total: 1400 }, limitations: ['a', 'b'] }, 5)
  turn = applyEvent(retrieverTurns, turn, { type: 'delta', text: 'Found' }, 6)
  turn = applyEvent(retrieverTurns, turn, { type: 'final', reply: 'Found' }, 7)
  assert.equal(turn.status, 'complete')
  assert.equal(retrieverTurns.hasInsight(turn.insight), true)
  assert.deepEqual(turn.insight.diagnostics.timings, { plan: 1200, retrieve: 100, total: 1400 })
  assert.deepEqual(turn.insight.diagnostics.limitations, ['a', 'b'])
})

test('retriever: a stopped turn keeps its diagnostics', () => {
  const turn = applyEvent(retrieverTurns, retrieverTurn(), { type: 'retriever.diagnostics', timings: { plan: 5 } }, 1)
  const stopped = stopTurn(retrieverTurns, turn, 2)
  assert.deepEqual(stopped.insight.diagnostics.timings, { plan: 5 })
  assert.equal(endText(stopped), STOPPED_TEXT)
})
