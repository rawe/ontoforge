import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { EntityCard, EntityLink } from '../src/api/entities.ts'
import { citedCards, mapBounded, planAdd, relationsToFetch } from '../src/components/explore/answerCanvas.ts'

const card = (ref: string, id: string, patch: Partial<EntityCard> = {}): EntityCard => ({
  ref, id, type: 'person', typeName: 'Person', label: id, fields: [], role: 'reached', hop: 1, evidence: true, ...patch,
})
const link = (id: string, from: string, to: string, type = 'works_on'): EntityLink => ({ id, from, to, type, label: type })

/** Kubernetes (anchor) ← required by Beacon (hop 1) ← worked on by Ana and Ben (hop 2). */
const K8S = card('E1', 'k8s', { type: 'skill', role: 'anchor', hop: 0 })
const BEACON = card('E2', 'beacon', { type: 'project', hop: 1 })
const ANA = card('E3', 'ana', { hop: 2 })
const BEN = card('E4', 'ben', { hop: 2 })
const ANSWER = {
  entities: [K8S, BEACON, ANA, BEN],
  links: [link('r1', 'E2', 'E1', 'requires_skill'), link('r2', 'E3', 'E2'), link('r3', 'E4', 'E2')],
}

/* -------------------------------- citations -------------------------------- */

test('cited cards: evidence cited in the answer, once each, in order of first citation', () => {
  const entities = [K8S, BEACON, ANA, card('E5', 'zed', { evidence: false })]
  const cited = citedCards('Ana [E3] works on Beacon [E2, E3], which needs Kubernetes [E1]. Not [E5] or [E9].', entities)
  assert.deepEqual(cited.map((c) => c.id), ['ana', 'beacon', 'k8s'])
  assert.deepEqual(citedCards('No citations.', entities), [])
})

/* ---------------------------------- plan ----------------------------------- */

test('what would be added: new entities in hop order, present ones apart, each once', () => {
  const plan = planAdd([BEN, ANA, BEACON, K8S, ANA], ANSWER, new Set(['beacon']), 1, 300)
  assert.deepEqual(plan.fresh.map((p) => p.card.id), ['k8s', 'ana', 'ben'])
  assert.deepEqual(plan.present, ['beacon'])
  assert.equal(plan.refused, false)
})

test('placement anchors: each entity next to a linked one nearer to the anchors first', () => {
  const plan = planAdd([K8S, BEACON, ANA, BEN], ANSWER, new Set(), 0, 300)
  assert.deepEqual(plan.fresh.map((p) => [p.card.id, p.level, p.anchors]), [
    ['k8s', 0, ['beacon']],
    ['beacon', 1, ['k8s', 'ana', 'ben']],
    ['ana', 2, ['beacon']],
    ['ben', 2, ['beacon']],
  ])
})

test('anchors and carried-over entities are level 0 whatever their hop', () => {
  const focus = card('E1', 'f', { role: 'focus', hop: 3 })
  const plan = planAdd([card('E2', 'r', { hop: 1 }), focus], { entities: [focus, card('E2', 'r', { hop: 1 })], links: [] }, new Set(), 0, 300)
  assert.deepEqual(plan.fresh.map((p) => [p.card.id, p.level]), [['f', 0], ['r', 1]])
  assert.deepEqual(plan.fresh[1]!.anchors, [])
})

test('cards without role or hop (agents, retrievers) are level 0, next to an entity they are linked to', () => {
  const plain = (ref: string, id: string) => card(ref, id, { role: undefined, hop: undefined })
  const beacon = plain('E1', 'beacon')
  const ana = plain('E2', 'ana')
  const lone = plain('E3', 'lone')
  const answer = { entities: [beacon, ana, lone], links: [link('r1', 'E2', 'E1')] }
  const plan = planAdd([ana, lone], answer, new Set(['beacon']), 1, 300)
  assert.deepEqual(plan.fresh.map((p) => [p.card.id, p.level, p.anchors]), [['ana', 0, ['beacon']], ['lone', 0, []]])
  assert.deepEqual(plan.present, [])
})

test('the cap refuses a batch as a whole; one exactly at the cap fits; present ones never count', () => {
  assert.equal(planAdd([ANA, BEN], ANSWER, new Set(), 299, 300).refused, true)
  assert.equal(planAdd([ANA, BEN], ANSWER, new Set(), 298, 300).refused, false)
  const onlyPresent = planAdd([ANA], ANSWER, new Set(['ana']), 300, 300)
  assert.equal(onlyPresent.refused, false)
  assert.deepEqual(onlyPresent.present, ['ana'])
})

/* -------------------------------- relations -------------------------------- */

test('link → relation reads: only between canvas entities, not yet edges, each once', () => {
  const answer = { ...ANSWER, links: [...ANSWER.links, link('r2', 'E3', 'E2'), link('r4', 'E3', 'E2', 'leads')] }
  assert.deepEqual(
    relationsToFetch(answer, new Set(['k8s', 'beacon', 'ana']), new Set(['r1'])),
    [{ type: 'works_on', id: 'r2' }, { type: 'leads', id: 'r4' }],
  )
})

test('link → relation reads: `touching` keeps those at one entity', () => {
  const onCanvas = new Set(['k8s', 'beacon', 'ana', 'ben'])
  assert.deepEqual(relationsToFetch(ANSWER, onCanvas, new Set(), 'ben'), [{ type: 'works_on', id: 'r3' }])
  assert.deepEqual(relationsToFetch(ANSWER, onCanvas, new Set(), 'nobody'), [])
})

test('a link without a type or to an unknown ref is skipped', () => {
  const answer = { entities: [ANA, BEACON], links: [{ id: 'x', from: 'E3', to: 'E2' }, link('y', 'E3', 'E9')] }
  assert.deepEqual(relationsToFetch(answer, new Set(['ana', 'beacon']), new Set()), [])
})

/* --------------------------------- bounded --------------------------------- */

test('bounded reads: at most `limit` at once, results in order, failures settled', async () => {
  let running = 0
  let peak = 0
  const results = await mapBounded([1, 2, 3, 4, 5], 2, async (n) => {
    running++
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, 5))
    running--
    if (n === 3) throw new Error('gone')
    return n * 10
  })
  assert.equal(peak, 2)
  assert.deepEqual(results.map((r) => (r.status === 'fulfilled' ? r.value : 'x')), [10, 20, 'x', 40, 50])
  assert.deepEqual(await mapBounded([], 4, async () => 1), [])
})
