import assert from 'node:assert/strict'
import test from 'node:test'
import type { EntityInstance } from '../src/api/types.ts'
import { planRelationReads, sampleEntities } from '../src/components/explore/quickLoad.ts'

const entity = (type: string, index: number): EntityInstance => ({
  _id: `${type}-${index}`, _entityTypeKey: type, _createdAt: '', _updatedAt: '',
})

test('quick load balances types and redistributes unused capacity from exhausted types', async () => {
  const data = { person: Array.from({ length: 30 }, (_, i) => entity('person', i)), team: [entity('team', 0)] }
  const result = await sampleEntities(['person', 'team'], new Set(), 10, async (key, page) => {
    const items = data[key as keyof typeof data]
    return { ...page, total: items.length, items: items.slice(page.offset, page.offset + page.limit) }
  })
  assert.equal(result.length, 10)
  assert.deepEqual(result.slice(0, 2).map(e => e._entityTypeKey), ['person', 'team'])
  assert.equal(result.filter(e => e._entityTypeKey === 'person').length, 9)
})

test('quick load pages beyond existing nodes and never adds duplicates or exceeds its budget', async () => {
  const data = Array.from({ length: 60 }, (_, i) => entity('person', i))
  const existing = new Set(data.slice(0, 40).map(e => e._id))
  let reads = 0
  const result = await sampleEntities(['person', 'person'], existing, 7, async (_key, page) => {
    reads++
    assert.ok(page.limit <= 200)
    return { ...page, total: data.length, items: data.slice(page.offset, page.offset + page.limit) }
  })
  assert.equal(result.length, 7)
  assert.equal(new Set(result.map(e => e._id)).size, 7)
  assert.ok(result.every(e => !existing.has(e._id)))
  assert.ok(reads > 1)
})

test('quick load stops on empty pages and reports failed reads', async () => {
  assert.deepEqual(await sampleEntities(['empty'], new Set(), 20, async (_key, page) => ({ ...page, items: [], total: 0 })), [])
  await assert.rejects(sampleEntities(['denied'], new Set(), 20, async () => { throw new Error('Lens access denied') }), /Lens access denied/)
})

test('quick load reads relations only for the entities it adds, in both directions', () => {
  const types = [
    { key: 'member_of', fromEntityTypeKey: 'person', toEntityTypeKey: 'team' },
    { key: 'reports_to', fromEntityTypeKey: 'person', toEntityTypeKey: 'person' },
  ]
  const reads = planRelationReads(types, [entity('person', 1), entity('team', 2)])
  assert.deepEqual(reads, [
    { type: 'member_of', direction: 'outgoing', entityId: 'person-1' },
    { type: 'member_of', direction: 'incoming', entityId: 'team-2' },
    { type: 'reports_to', direction: 'outgoing', entityId: 'person-1' },
    { type: 'reports_to', direction: 'incoming', entityId: 'person-1' },
  ])
  assert.deepEqual(planRelationReads(types, []), [])
})
