import assert from 'node:assert/strict'
import test from 'node:test'
import type { EntityInstance, RuntimeSchema, SchemaProperty } from '../src/api/types.ts'
import { buildExploreGraph3D } from '../src/components/explore/graph3dModel.ts'
import type { EntityFlowNode, RelationFlowEdge } from '../src/components/explore/workingSet.ts'

const property = (key: string, dataType: SchemaProperty['dataType'] = 'string'): SchemaProperty => ({
  key, displayName: key, dataType, description: null, required: false, defaultValue: null,
})
const schema: RuntimeSchema = {
  lens: { key: 'public', name: 'Public', description: null },
  entityTypes: [{
    key: 'person', displayName: 'Person', description: 'A generic schema description',
    nameProperty: 'name', identityProperties: ['code'],
    properties: [property('name'), ...Array.from({ length: 8 }, (_, i) => property(`field${i}`)), property('enabled', 'boolean'), property('score', 'integer'), property('notes', 'document')],
  }],
  relationTypes: [{
    key: 'mentors', displayName: 'Mentors', description: 'Another schema description',
    fromEntityTypeKey: 'person', toEntityTypeKey: 'person', parent: null,
    properties: [property('since'), property('notes', 'document')],
  }],
}
const node = (id: string, values: Partial<EntityInstance> = {}): EntityFlowNode => ({
  id, type: 'entity', position: { x: 0, y: 0 },
  data: {
    entity: { _id: id, _entityTypeKey: 'person', _createdAt: '', _updatedAt: '', name: id, ...values },
    typeName: 'Person', pinned: false, flashedAt: 0,
  },
})
const edge = (id: string, source: string, target: string): RelationFlowEdge => ({
  id, source, target, type: 'relation',
  data: { relation: {
    _id: id, _relationTypeKey: 'mentors', _createdAt: '', _updatedAt: '', fromEntityId: source, toEntityId: target,
    since: '2020', hiddenField: 'Keep hidden', notes: { document: true, length: 1200 },
  } },
})
const formatters = {
  displayLabel: (entity: EntityInstance) => String(entity.name ?? entity._id),
  formatValue: (_type: SchemaProperty['dataType'], value: EntityInstance[string]) => value == null ? null : String(value),
}

test('instance details retain all visible fields and returned identity without repeating type descriptions', () => {
  const alice = node('alice', {
    _identity: 'A~01', hiddenField: 'Keep hidden',
    ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`field${i}`, `value${i}`])),
    enabled: false, score: 0, notes: { document: true, length: 1200 },
  })
  alice.data.pinned = true
  alice.data.highlighted = true
  const result = buildExploreGraph3D([alice, node('bob')], [edge('ab', 'alice', 'bob')], schema, formatters)
  const first = result.nodes[0]!
  assert.equal(first.identity, 'A~01')
  assert.equal(first.subtitle, 'Person · pinned')
  assert.equal(first.highlighted, true)
  assert.equal(first.description, undefined)
  assert.equal(first.properties?.length, 11)
  assert.ok(first.properties?.some(p => p.label === 'field7' && p.value === 'value7'))
  assert.ok(first.properties?.some(p => p.label === 'enabled' && p.value === 'false'))
  assert.ok(first.properties?.some(p => p.label === 'score' && p.value === '0'))
  assert.ok(first.properties?.some(p => p.label === 'notes' && p.value === 'Document · 1.2 KB'))
  assert.ok(!first.properties?.some(p => p.label === 'name' || p.label === 'hiddenField'))
  assert.equal(result.nodes[1]?.identity, undefined)
  assert.equal(result.edges[0]?.description, undefined)
  assert.deepEqual(result.edges[0]?.properties, [
    { label: 'since', value: '2020' }, { label: 'notes', value: 'Document · 1.2 KB' },
  ])
  assert.equal(result.edges[0]?.source, 'alice')
  assert.equal(result.edges[0]?.target, 'bob')
})

test('identity is never derived and documents never show inline bodies', () => {
  const scoped = { ...schema, entityTypes: schema.entityTypes.map(type => ({ ...type, identityProperties: null })) }
  const result = buildExploreGraph3D([node('alice', { _identity: 'hidden', notes: 'Private document body' })], [], scoped, formatters)
  assert.equal(result.nodes[0]?.identity, undefined)
  assert.deepEqual(result.nodes[0]?.properties, [{ label: 'notes', value: 'Document · 21 chars' }])
  assert.ok(!JSON.stringify(result).includes('Private document body'))
  const noReturnedIdentity = buildExploreGraph3D([node('alice', { code: 'A' })], [], schema, formatters)
  assert.equal(noReturnedIdentity.nodes[0]?.identity, undefined)
})

test('connection summaries count only visible relations with accurate incoming, outgoing and self-loop directions', () => {
  const hiddenNode = { ...node('hidden'), hidden: true }
  const hiddenEdge = { ...edge('hidden-edge', 'alice', 'bob'), hidden: true }
  const parent = edge('ab1', 'alice', 'bob')
  parent.data!.parent = true
  const result = buildExploreGraph3D(
    [node('alice'), node('bob'), node('isolated'), hiddenNode],
    [parent, edge('ab2', 'alice', 'bob'), edge('ba', 'bob', 'alice'), edge('loop', 'alice', 'alice'),
      edge('to-hidden', 'alice', 'hidden'), edge('to-missing', 'alice', 'missing'), hiddenEdge],
    schema, formatters,
  )
  assert.deepEqual(result.nodes.map(n => n.id), ['alice', 'bob', 'isolated'])
  assert.deepEqual(result.edges.map(e => e.id), ['ab1', 'ab2', 'ba', 'loop'])
  assert.equal(result.edges[0]?.parent, true)
  assert.deepEqual(result.nodes[0]?.connections, [
    { label: 'Outgoing · Mentors → Person', value: '3 relations' },
    { label: 'Incoming · Mentors ← Person', value: '2 relations' },
  ])
  assert.deepEqual(result.nodes[1]?.connections, [
    { label: 'Incoming · Mentors ← Person', value: '2 relations' },
    { label: 'Outgoing · Mentors → Person', value: '1 relation' },
  ])
  assert.deepEqual(result.nodes[2]?.connections, [])
})
