import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAssistantStream } from '../src/assistants/stream/chatStream.ts'
import { applyEvent, failTurn, pendingTurn, stopTurn } from '../src/assistants/conversation/chatModel.ts'
import { graphKindReader, type GraphEvent } from '../src/api/graphEvents.ts'
import { graphTurns, stepState } from '../src/components/assistants/graph/graphTurnModel.ts'

const GRAPH = {
  type: 'navigator.graph',
  steps: [
    { id: 'understand', label: 'Understand', description: 'Reads the question.', model: true },
    { id: 'anchor', label: 'Anchor', description: 'Finds the entities.', model: false },
    { id: 'walk', label: 'Walk', description: 'Follows relations.', model: false },
    { id: 'answer', label: 'Answer', description: 'Writes the answer.', model: true },
  ],
  edges: [{ from: 'understand', to: 'anchor' }, { from: 'anchor', to: 'walk' }, { from: 'walk', to: 'walk', label: 'widen' }, { from: 'walk', to: 'answer' }],
}
function response(lines: unknown[]) {
  return new Response(lines.map((line) => JSON.stringify(line)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } })
}
const read = async (lines: unknown[], kind = 'navigator') => {
  const received: unknown[] = []
  await readAssistantStream(response(lines), graphKindReader(kind), (e) => received.push(e))
  return received
}
const THREAD = { type: 'thread', threadId: 't1' }
const FINAL = { type: 'final', reply: '' }

/* --------------------------------- reader ---------------------------------- */

test('the reader passes the three graph events of its kind through, beside the shared entities', async () => {
  const events = [
    THREAD, GRAPH,
    { type: 'navigator.step', id: 'walk', status: 'running', round: 1 },
    { type: 'navigator.step', id: 'walk', status: 'done', round: 1, durationMs: 42, summary: 'Hop 1: 14 entities' },
    { type: 'entities', entities: [{ ref: 'E1', id: 'a', type: 'person', typeName: 'Person', label: 'Ana', fields: [], evidence: true, role: 'anchor', hop: 0 }], links: [] },
    { type: 'navigator.summary', modelCalls: 2, durationMs: 3120, entities: 23, evidence: 11, hops: 2, timings: { walk: 61 } },
    FINAL,
  ]
  assert.deepEqual(await read(events), events)
})

test('the reader ignores other kinds’ and unknown dotted events of its own kind', async () => {
  // Entities come as the shared event; a dotted kind event this client does not know is ignored.
  const received = await read([THREAD, { type: 'analyst.table', rows: [] }, { type: 'navigator.later', x: 1 }, { type: 'navigator.entities', entities: 7 }, { type: 'retriever.phase', phase: 'plan' }, FINAL])
  assert.deepEqual(received, [THREAD, FINAL])
})

for (const [name, event] of [
  ['a step with an unknown status', { type: 'navigator.step', id: 'walk', status: 'paused' }],
  ['a step without id', { type: 'navigator.step', status: 'done' }],
  ['a step with round 0', { type: 'navigator.step', id: 'walk', status: 'done', round: 0 }],
  ['a graph without edges', { type: 'navigator.graph', steps: [] }],
  ['a graph step without label', { type: 'navigator.graph', steps: [{ id: 'a' }], edges: [] }],
  ['a summary with a string count', { type: 'navigator.summary', modelCalls: '2' }],
  ['an undotted unknown event', { type: 'graph', steps: [], edges: [] }],
] as const) {
  test(`the reader refuses ${name}`, async () => {
    await assert.rejects(read([THREAD, event, FINAL]))
  })
}

/* -------------------------------- turn model ------------------------------- */

const fold = (events: GraphEvent[]) => {
  let turn = pendingTurn('t', 'q', graphTurns.empty(), 0)
  events.forEach((event, i) => { turn = applyEvent(graphTurns, turn, event, i + 1) })
  return turn
}

test('steps go running → done per id and round; repeated rounds are separate runs', () => {
  const turn = fold([
    GRAPH,
    { type: 'navigator.step', id: 'walk', status: 'running', round: 1 },
    { type: 'navigator.step', id: 'walk', status: 'done', round: 1, durationMs: 40, summary: 'Hop 1: 3 entities' },
    { type: 'navigator.step', id: 'walk', status: 'running', round: 2 },
  ])
  assert.deepEqual(turn.insight.steps, [
    { id: 'walk', round: 1, status: 'done', durationMs: 40, summary: 'Hop 1: 3 entities' },
    { id: 'walk', round: 2, status: 'running' },
  ])
  assert.equal(graphTurns.progress(turn.insight), 'Walk · round 2')
  assert.equal(stepState(turn.insight, 'walk', false), 'running')
  assert.equal(stepState(turn.insight, 'answer', false), 'waiting')
  assert.equal(stepState(turn.insight, 'answer', true), 'not-run')
})

test('a step without round is round 1; progress names running steps by label, none when idle', () => {
  const running = fold([GRAPH, { type: 'navigator.step', id: 'understand', status: 'running' }])
  assert.equal(running.insight.steps[0]!.round, 1)
  assert.equal(graphTurns.progress(running.insight), 'Understand')
  const done = fold([GRAPH, { type: 'navigator.step', id: 'understand', status: 'running' }, { type: 'navigator.step', id: 'understand', status: 'skipped' }])
  assert.equal(done.insight.steps.length, 1)
  assert.equal(done.insight.steps[0]!.status, 'skipped')
  assert.equal(graphTurns.progress(done.insight), undefined)
  // Without the pipeline the id stands in for the label.
  assert.equal(graphTurns.progress(fold([{ type: 'navigator.step', id: 'focus', status: 'running' }]).insight), 'focus')
})

test('a failed or stopped turn interrupts the running steps and keeps the finished ones', () => {
  const turn = fold([
    { type: 'navigator.step', id: 'anchor', status: 'done', round: 1 },
    { type: 'navigator.step', id: 'walk', status: 'running', round: 1 },
  ])
  for (const ended of [failTurn(graphTurns, turn, 'boom', 9), stopTurn(graphTurns, turn, 9)]) {
    assert.deepEqual(ended.insight.steps.map((s) => s.status), ['done', 'interrupted'])
  }
})

test('the summary and the pipeline are kept', () => {
  const turn = fold([GRAPH, { type: 'navigator.summary', modelCalls: 2, durationMs: 3120, entities: 23, evidence: 11 }])
  assert.equal(turn.insight.summary?.modelCalls, 2)
  assert.equal(turn.insight.summary?.durationMs, 3120)
  assert.deepEqual(turn.insight.graph?.steps.map((s) => s.id), ['understand', 'anchor', 'walk', 'answer'])
  assert.equal(graphTurns.hasInsight(turn.insight), true)
  assert.equal(graphTurns.hasInsight(graphTurns.empty()), false)
})
