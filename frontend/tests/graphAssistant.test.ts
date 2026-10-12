import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAssistantStream } from '../src/api/chatStream.ts'
import { applyEvent, failTurn, pendingTurn, stopTurn } from '../src/components/assistants/chat/chatModel.ts'
import { graphKindReader, type EntityCard, type GraphEvent } from '../src/components/assistants/graph/graphEvents.ts'
import { citations, graphTurns, groupByRole, stepState } from '../src/components/assistants/graph/graphTurnModel.ts'

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
const card = (ref: string, patch: Partial<EntityCard> = {}): EntityCard => ({
  ref, id: `id-${ref}`, type: 'person', typeName: 'Person', label: `Label ${ref}`, role: 'reached',
  hop: 1, reason: 'why', fields: [{ name: 'Email', value: 'x@y' }], evidence: false, ...patch,
})

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

test('the reader passes the four graph events of its kind through', async () => {
  const events = [
    THREAD, GRAPH,
    { type: 'navigator.step', id: 'walk', status: 'running', round: 1 },
    { type: 'navigator.step', id: 'walk', status: 'done', round: 1, durationMs: 42, summary: 'Hop 1: 14 entities' },
    { type: 'navigator.entities', entities: [card('E1', { role: 'anchor', hop: 0 })], links: [{ id: 'r1', from: 'E1', to: 'E2', type: 'works_on', label: 'works on' }] },
    { type: 'navigator.summary', modelCalls: 2, durationMs: 3120, entities: 23, evidence: 11, hops: 2, timings: { walk: 61 } },
    FINAL,
  ]
  assert.deepEqual(await read(events), events)
})

test('the reader ignores other kinds’ and unknown dotted events of its own kind', async () => {
  const received = await read([THREAD, { type: 'analyst.table', rows: [] }, { type: 'navigator.later', x: 1 }, { type: 'retriever.phase', phase: 'plan' }, FINAL])
  assert.deepEqual(received, [THREAD, FINAL])
})

for (const [name, event] of [
  ['a step with an unknown status', { type: 'navigator.step', id: 'walk', status: 'paused' }],
  ['a step without id', { type: 'navigator.step', status: 'done' }],
  ['a step with round 0', { type: 'navigator.step', id: 'walk', status: 'done', round: 0 }],
  ['a graph without edges', { type: 'navigator.graph', steps: [] }],
  ['a graph step without label', { type: 'navigator.graph', steps: [{ id: 'a' }], edges: [] }],
  ['a card without ref', { type: 'navigator.entities', entities: [{ ...card('E1'), ref: undefined }] }],
  ['a card with a numeric field value', { type: 'navigator.entities', entities: [card('E1', { fields: [{ name: 'Level', value: 6 as unknown as string }] })] }],
  ['a link without target', { type: 'navigator.entities', entities: [], links: [{ id: 'r1', from: 'E1' }] }],
  ['a link without id', { type: 'navigator.entities', entities: [], links: [{ from: 'E1', to: 'E2' }] }],
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

test('entities upsert by ref in place; links upsert by id', () => {
  const turn = fold([
    { type: 'navigator.entities', entities: [card('E1', { role: 'anchor' }), card('E2')], links: [{ id: 'r1', from: 'E1', to: 'E2', type: 'works_on', label: 'works on' }] },
    {
      type: 'navigator.entities',
      entities: [card('E3'), card('E2', { evidence: true, label: 'Apollo' })],
      links: [
        { id: 'r1', from: 'E1', to: 'E2', type: 'works_on', label: 'works on' },
        { id: 'r2', from: 'E1', to: 'E2', type: 'owns', label: 'owns' },
        { id: 'r3', from: 'E2', to: 'E3', type: 'works_on', label: 'works on' },
        // A second stored relation of the same type between the same pair: a link of its own.
        { id: 'r4', from: 'E1', to: 'E2', type: 'works_on', label: 'works on' },
      ],
    },
  ])
  assert.deepEqual(turn.insight.entities.map((c) => [c.ref, c.label, c.evidence]), [
    ['E1', 'Label E1', false], ['E2', 'Apollo', true], ['E3', 'Label E3', false],
  ])
  assert.deepEqual(turn.insight.links.map((l) => `${l.from}-${l.type}-${l.to}`), ['E1-works_on-E2', 'E1-owns-E2', 'E2-works_on-E3', 'E1-works_on-E2'])
  assert.equal(graphTurns.hasInsight(turn.insight), true)
  assert.equal(graphTurns.hasInsight(graphTurns.empty()), false)
})

test('the summary and the pipeline are kept', () => {
  const turn = fold([GRAPH, { type: 'navigator.summary', modelCalls: 2, durationMs: 3120, entities: 23, evidence: 11 }])
  assert.equal(turn.insight.summary?.modelCalls, 2)
  assert.equal(turn.insight.summary?.durationMs, 3120)
  assert.deepEqual(turn.insight.graph?.steps.map((s) => s.id), ['understand', 'anchor', 'walk', 'answer'])
})

test('cards group by role: anchor, focus, then reached; unknown roles after', () => {
  const groups = groupByRole([card('E1'), card('E2', { role: 'odd' }), card('E3', { role: 'anchor' }), card('E4', { role: 'focus' }), card('E5')])
  assert.deepEqual(groups.map((g) => [g.role, g.cards.map((c) => c.ref)]), [
    ['anchor', ['E3']], ['focus', ['E4']], ['reached', ['E1', 'E5']], ['odd', ['E2']],
  ])
})

/* -------------------------------- citations -------------------------------- */

const CARDS = [card('E1', { evidence: true }), card('E2', { evidence: true }), card('E3')]

test('single and grouped citations of evidence become ref segments', () => {
  assert.deepEqual(citations('Lena works on Apollo [E2]. Both [E1, E2] matter.', CARDS).map((s) => (s.kind === 'text' ? s.text : `<${s.ref}>`)), [
    'Lena works on Apollo ', '<E2>', '. Both ', '<E1>', '<E2>', ' matter.',
  ])
  const [, cite] = citations('See [E1]', CARDS)
  assert.equal(cite?.kind === 'cite' && cite.card.label, 'Label E1')
})

test('unknown and non-evidence refs stay plain text', () => {
  assert.deepEqual(citations('Not cited [E3] nor [E9] or [x].', CARDS), [{ kind: 'text', text: 'Not cited [E3] nor [E9] or [x].' }])
  assert.deepEqual(citations('Mixed [E1, E9, E3].', CARDS).map((s) => (s.kind === 'text' ? s.text : `<${s.ref}>`)), [
    'Mixed ', '<E1>', '[E9][E3].',
  ])
  assert.deepEqual(citations('', CARDS), [])
  assert.deepEqual(citations('[E1]', []), [{ kind: 'text', text: '[E1]' }])
})
