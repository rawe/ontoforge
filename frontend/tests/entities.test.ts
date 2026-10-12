import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentReader, readAssistantStream } from '../src/api/chatStream.ts'
import type { EntityCard, EntityLink } from '../src/api/entities.ts'
import { graphKindReader } from '../src/api/graphEvents.ts'
import { readRetrieverStream } from '../src/api/retrievers.ts'
import { applyEvent, hasDetail, inspectedTurn, pendingTurn, restoredTurns, type Turn } from '../src/components/assistants/chat/chatModel.ts'
import { agentTurns } from '../src/components/assistants/agents/toolCallModel.ts'
import { citations, groupByRole } from '../src/components/assistants/entities/entityModel.ts'
import { graphTurns } from '../src/components/assistants/graph/graphTurnModel.ts'

const card = (ref: string, patch: Partial<EntityCard> = {}): EntityCard => ({
  ref, id: `id-${ref}`, type: 'person', typeName: 'Person', label: `Label ${ref}`, fields: [{ name: 'Email', value: 'x@y' }], evidence: false, ...patch,
})
const link = (id: string, from: string, to: string, type = 'works_on'): EntityLink => ({ id, from, to, type, label: type })

function response(lines: unknown[]) {
  return new Response(lines.map((line) => JSON.stringify(line)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } })
}
const THREAD = { type: 'thread', threadId: 't1' }
const FINAL = { type: 'final', reply: '' }
type Read = (response: Response, onEvent: (event: unknown) => void) => Promise<void>
const KINDS: Record<string, Read> = {
  agent: (r, onEvent) => readAssistantStream(r, agentReader(), onEvent),
  retriever: (r, onEvent) => readRetrieverStream(r, onEvent, new AbortController().signal),
  navigator: (r, onEvent) => readAssistantStream(r, graphKindReader('navigator'), onEvent),
}
const read = async (lines: unknown[], kind = 'agent') => {
  const received: unknown[] = []
  await KINDS[kind]!(response(lines), (e) => received.push(e))
  return received
}

/* --------------------------------- reader ---------------------------------- */

test('every kind reads the shared entities event; links may join cards of an earlier event', async () => {
  const events = [
    THREAD,
    { type: 'entities', entities: [card('E1', { role: 'anchor', hop: 0, reason: 'named' })], links: [] },
    { type: 'entities', entities: [card('E2', { evidence: true })], links: [link('r1', 'E1', 'E2')] },
    FINAL,
  ]
  for (const kind of Object.keys(KINDS)) assert.deepEqual(await read(events, kind), events)
})

for (const [name, event] of [
  ['a card without ref', { type: 'entities', entities: [{ ...card('E1'), ref: undefined }], links: [] }],
  ['a card without fields', { type: 'entities', entities: [{ ...card('E1'), fields: undefined }], links: [] }],
  ['a card with a numeric field value', { type: 'entities', entities: [card('E1', { fields: [{ name: 'Level', value: 6 as unknown as string }] })], links: [] }],
  ['a card without evidence', { type: 'entities', entities: [{ ...card('E1'), evidence: undefined }], links: [] }],
  ['a card with a numeric role', { type: 'entities', entities: [card('E1', { role: 1 as unknown as string })], links: [] }],
  ['an event without links', { type: 'entities', entities: [card('E1')] }],
  ['a link without id', { type: 'entities', entities: [card('E1'), card('E2')], links: [{ from: 'E1', to: 'E2', type: 't', label: 't' }] }],
  ['a link without label', { type: 'entities', entities: [card('E1'), card('E2')], links: [{ id: 'r1', from: 'E1', to: 'E2', type: 't' }] }],
  ['a link to a card the turn never sent', { type: 'entities', entities: [card('E1')], links: [link('r1', 'E1', 'E9')] }],
] as const) {
  test(`the shared reader refuses ${name}`, async () => {
    await assert.rejects(read([THREAD, event, FINAL]))
  })
}

test('refs belong to one turn: a link to a card of another stream is refused', async () => {
  await read([THREAD, { type: 'entities', entities: [card('E1'), card('E2')], links: [] }, FINAL])
  await assert.rejects(read([THREAD, { type: 'entities', entities: [card('E2')], links: [link('r1', 'E1', 'E2')] }, FINAL]))
})

/* ---------------------------------- fold ----------------------------------- */

const fold = (events: Parameters<typeof applyEvent>[2][]) => {
  let turn = pendingTurn('t', 'q', agentTurns.empty(), 0)
  events.forEach((event, i) => { turn = applyEvent(agentTurns, turn, event as never, i + 1) })
  return turn
}

test('a new or restored turn has no entities', () => {
  const turn = pendingTurn('t', 'q', graphTurns.empty(), 0)
  assert.deepEqual([turn.entities, turn.links], [[], []])
  const [restored] = restoredTurns([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }], agentTurns.empty, () => 'r')
  assert.deepEqual([restored!.entities, restored!.links], [[], []])
})

test('entities upsert by ref in place and links by id, for any kind; the insight stays the kind’s', () => {
  const turn = fold([
    { type: 'entities', entities: [card('E1', { role: 'anchor' }), card('E2')], links: [link('r1', 'E1', 'E2')] },
    {
      type: 'entities',
      entities: [card('E3'), card('E2', { evidence: true, label: 'Apollo' })],
      links: [
        link('r1', 'E1', 'E2'),
        link('r2', 'E1', 'E2', 'owns'),
        link('r3', 'E2', 'E3'),
        // A second stored relation of the same type between the same pair: a link of its own.
        link('r4', 'E1', 'E2'),
      ],
    },
  ])
  assert.deepEqual(turn.entities.map((c) => [c.ref, c.label, c.evidence]), [
    ['E1', 'Label E1', false], ['E2', 'Apollo', true], ['E3', 'Label E3', false],
  ])
  assert.deepEqual(turn.links.map((l) => `${l.from}-${l.type}-${l.to}`), ['E1-works_on-E2', 'E1-owns-E2', 'E2-works_on-E3', 'E1-works_on-E2'])
  assert.deepEqual(turn.insight, [])
  assert.equal(turn.status, 'pending')
})

test('a turn with entities has something for the side panel, even without the kind’s insight', () => {
  const plain = (id: string): Turn<unknown[]> => ({ id, question: id, reply: '', status: 'complete', entities: [], links: [], insight: [] })
  const met = { ...plain('b'), entities: [card('E1')] }
  assert.equal(hasDetail(plain('a'), agentTurns.hasInsight), false)
  assert.equal(hasDetail(met, agentTurns.hasInsight), true)
  assert.equal(inspectedTurn([plain('a'), met, plain('c')], null, agentTurns.hasInsight)?.id, 'b')
})

/* ---------------------------------- roles ---------------------------------- */

test('cards group by role: anchor, focus, then reached; unknown roles after, none last', () => {
  const groups = groupByRole([
    card('E1', { role: 'reached' }), card('E2', { role: 'odd' }), card('E3', { role: 'anchor' }),
    card('E4', { role: 'focus' }), card('E5', { role: 'reached' }), card('E6'),
  ])
  assert.deepEqual(groups?.map((g) => [g.role, g.cards.map((c) => c.ref)]), [
    ['anchor', ['E3']], ['focus', ['E4']], ['reached', ['E1', 'E5']], ['odd', ['E2']], ['', ['E6']],
  ])
})

test('cards without any role stay one flat list', () => {
  assert.equal(groupByRole([card('E1'), card('E2')]), null)
  assert.equal(groupByRole([]), null)
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

test('unknown and non-evidence refs stay plain text; text without citations is one segment', () => {
  assert.deepEqual(citations('Not cited [E3] nor [E9] or [x].', CARDS), [{ kind: 'text', text: 'Not cited [E3] nor [E9] or [x].' }])
  assert.deepEqual(citations('Mixed [E1, E9, E3].', CARDS).map((s) => (s.kind === 'text' ? s.text : `<${s.ref}>`)), [
    'Mixed ', '<E1>', '[E9][E3].',
  ])
  assert.deepEqual(citations('', CARDS), [])
  assert.deepEqual(citations('[E1]', []), [{ kind: 'text', text: '[E1]' }])
  assert.deepEqual(citations('An agent’s answer.', CARDS), [{ kind: 'text', text: 'An agent’s answer.' }])
})
