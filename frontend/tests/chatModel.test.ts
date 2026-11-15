import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STOPPED_TEXT,
  applyEvent,
  elapsedSeconds,
  endText,
  failTurn,
  formatDuration,
  hasDetail,
  inspectedTurn,
  pendingTurn,
  restoredTurns,
  stopTurn,
  type Turn,
  type TurnModel,
} from '../src/assistants/conversation/chatModel.ts'
import {
  agentTurns,
  toolCallCounts,
  toolCallSummary,
  toolCallTurns,
  toolError,
  toolResultMore,
} from '../src/assistants/steps/toolCallModel.ts'
import { retrieverTurns, type RetrieverInsight } from '../src/components/assistants/retrievers/retrieverModel.ts'
import type { ToolCall } from '../src/api/types.ts'

const agentTurn = () => pendingTurn('t', 'q', agentTurns.empty(), 0)
const retrieverTurn = () => pendingTurn('t', 'q', retrieverTurns.empty(), 0)

/* --------------------------------- shared ---------------------------------- */

test('shared events build the answer for every kind: deltas append, final replaces and ends', () => {
  const flow = <E extends { type: string }, I>(model: TurnModel<E, I>) => {
    const turn = pendingTurn('t', 'q', model.empty(), 0)
    let t = applyEvent(model, turn, { type: 'thread', threadId: 'th' })
    assert.equal(t, turn)
    t = applyEvent(model, t, { type: 'delta', text: 'Hel' })
    t = applyEvent(model, t, { type: 'delta', text: 'lo' })
    assert.equal(t.reply, 'Hello')
    assert.equal(t.status, 'pending')
    t = applyEvent(model, t, { type: 'final', reply: 'Hello' })
    assert.equal(t.status, 'complete')
    assert.equal(endText(t), null)
    assert.equal(model.hasInsight(t.insight), false)
  }
  flow(agentTurns)
  flow(retrieverTurns)
})

test('diagnostics events merge on the turn beside the kind\'s insight, for every kind; a failed turn keeps them', () => {
  let t = agentTurn()
  assert.equal(t.diagnostics, undefined)
  assert.equal(hasDetail(t, agentTurns.hasInsight), false)
  t = applyEvent(agentTurns, t, { type: 'diagnostics', steps: [{ index: 1, model: true, startMs: 2, durationMs: 40, usage: { input: 10, output: 0 } }] })
  t = applyEvent(agentTurns, t, { type: 'agent.tool_call', callId: 'c', tool: 'search', args: {} })
  t = applyEvent(agentTurns, t, { type: 'diagnostics', steps: [{ index: 2, name: 'search', startMs: 45, durationMs: 5 }] })
  t = applyEvent(agentTurns, t, { type: 'agent.tool_result', callId: 'c', result: [] })
  t = applyEvent(agentTurns, t, { type: 'diagnostics', steps: [{ index: 3, model: true, startMs: 52, durationMs: 5, failed: true }] })
  t = applyEvent(agentTurns, t, { type: 'diagnostics', durationMs: 60 })
  t = applyEvent(agentTurns, t, { type: 'error', error: { code: 'MODEL_ERROR', message: 'down' } })
  assert.equal(t.status, 'failed')
  assert.equal(t.insight.length, 1)
  assert.deepEqual(t.diagnostics, {
    steps: [
      { index: 1, model: true, startMs: 2, durationMs: 40, usage: { input: 10, output: 0 } },
      { index: 2, name: 'search', startMs: 45, durationMs: 5 },
      { index: 3, model: true, startMs: 52, durationMs: 5, failed: true },
    ],
    durationMs: 60,
  })
  // Diagnostics are not the side panel's: they alone give it nothing to show.
  assert.equal(hasDetail({ ...agentTurn(), diagnostics: {} }, agentTurns.hasInsight), false)
})

test('an error event fails the turn and keeps the partial answer', () => {
  let t = applyEvent(retrieverTurns, retrieverTurn(), { type: 'delta', text: 'part' })
  t = applyEvent(retrieverTurns, t, { type: 'error', error: { code: 'X', message: 'model down' } })
  assert.equal(t.status, 'failed')
  assert.equal(t.reply, 'part')
  assert.equal(endText(t), 'Incomplete: model down')
})

test('a stopped turn says so, without a reason', () => {
  const t = stopTurn(retrieverTurns, retrieverTurn())
  assert.equal(t.status, 'failed')
  assert.equal(t.stopped, true)
  assert.equal(t.error, undefined)
  assert.equal(endText(t), STOPPED_TEXT)
  assert.equal(endText(failTurn(retrieverTurns, retrieverTurn(), 'Thread is busy')), 'Incomplete: Thread is busy')
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

test('restoredTurns gives an answer with artifacts its insight from them', () => {
  const restore = (artifacts: readonly unknown[]): ToolCall[] => artifacts.map((_, i) => ({ callId: `a${i}`, tool: 't', args: {}, status: 'completed' }))
  const turns = restoredTurns([
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'A', artifacts: [{ type: 'proposal' }] },
    { role: 'user', content: 'two' },
    { role: 'assistant', content: 'B' },
  ], agentTurns.empty, () => 'r', restore)
  assert.deepEqual(turns.map((t) => t.insight.map((c) => c.callId)), [['a0'], []])
})

test('inspectedTurn picks the chosen turn, else the latest with insight', () => {
  const call: ToolCall = { callId: 'c', tool: 'search', args: {}, status: 'completed' }
  const turn = (id: string, insight: ToolCall[]): Turn<ToolCall[]> => ({ id, question: id, reply: '', status: 'complete', entities: [], links: [], insight })
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

test('agent: tool events are matched out of order by callId; the running tool is the live detail', () => {
  let turn = agentTurn()
  turn = applyEvent(agentTurns, turn, { type: 'agent.tool_call', callId: 'a', tool: 'get_entity', args: { entity_id: 'x' } })
  turn = applyEvent(agentTurns, turn, { type: 'agent.tool_call', callId: 'b', tool: 'search', args: { query: 'q' } })
  assert.equal(agentTurns.progress(turn.insight), 'Get entity, Search')
  turn = applyEvent(agentTurns, turn, { type: 'agent.tool_result', callId: 'b', result: { ran: [], items: [], limitations: [] } })
  assert.equal(agentTurns.progress(turn.insight), 'Get entity')
  turn = applyEvent(agentTurns, turn, { type: 'agent.tool_result', callId: 'a', result: { _id: 'x' } })
  assert.equal(agentTurns.progress(turn.insight), undefined)
  turn = applyEvent(agentTurns, turn, { type: 'final', reply: 'done' })
  assert.equal(turn.status, 'complete')
  assert.equal(turn.reply, 'done')
  assert.deepEqual(turn.insight.map((c) => [c.callId, c.status]), [['a', 'completed'], ['b', 'completed']])
  assert.equal(agentTurns.hasInsight(turn.insight), true)
  assert.equal(agentTurns.hasInsight(agentTurns.empty()), false)
})

test('agent: a failed or stopped turn interrupts running calls', () => {
  const turn = applyEvent(agentTurns, agentTurn(), { type: 'agent.tool_call', callId: 'a', tool: 'search', args: {} })
  for (const ended of [failTurn(agentTurns, turn, 'boom'), stopTurn(agentTurns, turn), applyEvent(agentTurns, turn, { type: 'error', error: { code: 'X', message: 'm' } })]) {
    assert.equal(ended.status, 'failed')
    assert.equal(ended.insight[0]!.status, 'interrupted')
  }
})

test('toolError reads an {error} result only: its text, or the message of a {code, message} error', () => {
  const call = (result: unknown, status: ToolCall['status'] = 'completed'): ToolCall => ({ callId: 'c', tool: 't', args: {}, result, status })
  assert.equal(toolError(call({ error: 'not found' })), 'not found')
  assert.equal(toolError(call({ error: { code: 'RESOURCE_NOT_FOUND', message: "Lens 'x' not found" } })), "Lens 'x' not found")
  assert.equal(toolError(call({ error: { code: 'X' } })), null)
  assert.equal(toolError(call({ error: 'x', items: [] })), null)
  assert.equal(toolError(call('text')), null)
  assert.equal(toolError(call({ error: 'x' }, 'pending')), null)
})

test('toolResultMore reads the sentence of what a completed result left out, for every shape', () => {
  const call = (result: unknown, status: ToolCall['status'] = 'completed'): ToolCall => ({ callId: 'c', tool: 't', args: {}, result, status })
  const more = 'Showing rows 1-20 of 3400. If you need more, call list_entities again with the same arguments and offset: 20.'
  assert.equal(toolResultMore(call({ items: [], total: 3400, limit: 20, offset: 0, more })), more)
  assert.equal(toolResultMore(call({ columns: [], results: [], more })), more)
  assert.equal(toolResultMore(call({ entity: {}, neighbors: [], more })), more)
  assert.equal(toolResultMore(call({ propertyKey: 'body', content: 'x', more })), more)
  assert.equal(toolResultMore(call({ items: [], total: 3 })), null)
  assert.equal(toolResultMore(call({ more: '  ' })), null)
  assert.equal(toolResultMore(call({ more: 3 })), null)
  assert.equal(toolResultMore(call([{ more }])), null)
  assert.equal(toolResultMore(call(more)), null)
  assert.equal(toolResultMore(call({ more }, 'pending')), null)
  // An entity's own property of that name is not a note.
  assert.equal(toolResultMore(call({ _id: 'e1', _entityTypeKey: 'part', name: 'P', more })), null)
})

test('toolCallCounts counts the calls and those that answered with an error', () => {
  const call = (callId: string, result: unknown): ToolCall => ({ callId, tool: 't', args: {}, result, status: 'completed' })
  assert.deepEqual(toolCallCounts([]), { calls: 0, errors: 0 })
  assert.deepEqual(toolCallCounts([call('a', { valid: true }), call('b', { error: 'x' }), call('c', { error: { code: 'C', message: 'm' } })]), { calls: 3, errors: 2 })
})

test('studio: the tool events with its own prefix build the calls; another kind\'s are ignored', () => {
  const studioTurns = toolCallTurns('studio')
  let turn = pendingTurn('t', 'q', studioTurns.empty(), 0)
  turn = applyEvent(studioTurns, turn, { type: 'studio.tool_call', callId: 'a', tool: 'validate_lens', args: { lens_key: 'main' } })
  assert.equal(studioTurns.progress(turn.insight), 'Validate a lens')
  turn = applyEvent(studioTurns, turn, { type: 'agent.tool_call', callId: 'b', tool: 'search', args: {} } as never)
  turn = applyEvent(studioTurns, turn, { type: 'studio.tool_result', callId: 'a', result: { valid: true, errors: [] } })
  assert.deepEqual(turn.insight.map((c) => [c.callId, c.status]), [['a', 'completed']])
  assert.equal(toolCallSummary(turn.insight[0]!), 'main')
  const ended = stopTurn(studioTurns, applyEvent(studioTurns, turn, { type: 'studio.tool_call', callId: 'c', tool: 'get_schema', args: {} }))
  assert.deepEqual(ended.insight.map((c) => c.status), ['completed', 'interrupted'])
})

test('toolCallSummary says what a call asked for', () => {
  const summary = (tool: string, args: Record<string, unknown>) => toolCallSummary({ callId: 'c', tool, args, status: 'pending' })
  assert.equal(summary('search', { query: 'CTO', types: ['person'] }), '“CTO” in person')
  assert.equal(summary('search_documents', { query: 'CTO', types: null, documents: ['person.bio', 'company.about'] }), '“CTO” in person.bio, company.about')
  assert.equal(summary('execute_query', { query: 'MATCH (p:person)\n  RETURN p' }), 'MATCH (p:person) RETURN p')
  assert.equal(summary('list_entities', { entity_type_key: 'person', search: null, filters: { city: 'Berlin' } }), 'person · city = Berlin')
  assert.equal(summary('get_neighbors', { entity_type_key: 'person', entity_id: 'p1', direction: 'outgoing' }), 'person · p1 · outgoing')
  assert.equal(summary('get_schema', {}), undefined)
})

/* -------------------------------- retriever -------------------------------- */

test('retriever: the started phase is the live detail; its steps merge on the turn as they arrive', () => {
  let turn: Turn<RetrieverInsight> = retrieverTurn()
  assert.equal(retrieverTurns.progress(turn.insight), undefined)
  assert.equal(hasDetail(turn, retrieverTurns.hasInsight), false)
  turn = applyEvent(retrieverTurns, turn, { type: 'retriever.phase', phase: 'plan', status: 'start' })
  assert.equal(retrieverTurns.progress(turn.insight), 'Plan question')
  turn = applyEvent(retrieverTurns, turn, { type: 'diagnostics', steps: [{ index: 1, name: 'plan', model: true, startMs: 1, durationMs: 1200, plan: { subQueries: [] } }] })
  turn = applyEvent(retrieverTurns, turn, { type: 'retriever.phase', phase: 'plan', status: 'end' })
  assert.equal(retrieverTurns.progress(turn.insight), 'Plan question')
  turn = applyEvent(retrieverTurns, turn, { type: 'retriever.phase', phase: 'retrieve', status: 'start' })
  assert.equal(retrieverTurns.progress(turn.insight), 'Search indices')
  turn = applyEvent(retrieverTurns, turn, { type: 'diagnostics', steps: [{ index: 2, name: 'retrieve', startMs: 1202, durationMs: 100 }] })
  turn = applyEvent(retrieverTurns, turn, { type: 'delta', text: 'Found' })
  turn = applyEvent(retrieverTurns, turn, { type: 'diagnostics', durationMs: 1400 })
  turn = applyEvent(retrieverTurns, turn, { type: 'final', reply: 'Found' })
  assert.equal(turn.status, 'complete')
  assert.equal(hasDetail(turn, retrieverTurns.hasInsight), false)
  assert.deepEqual(turn.insight, { phase: 'retrieve' })
  assert.deepEqual(turn.diagnostics?.steps?.map((step) => step.name), ['plan', 'retrieve'])
  assert.equal(turn.diagnostics?.durationMs, 1400)
})

test('retriever: a stopped turn keeps its steps', () => {
  const turn = applyEvent(retrieverTurns, retrieverTurn(), { type: 'diagnostics', steps: [{ index: 1, name: 'plan', model: true, startMs: 0, durationMs: 5 }] })
  const stopped = stopTurn(retrieverTurns, turn)
  assert.equal(stopped.diagnostics?.steps?.length, 1)
  assert.equal(endText(stopped), STOPPED_TEXT)
})
