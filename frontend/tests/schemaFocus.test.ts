import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { EntityType, RelationType } from '../src/api/types.ts'
import { focusSet, hierarchySet } from '../src/components/studio/schema/focus.ts'

const entity = (key: string): EntityType => ({
  entityTypeId: `et-${key}`,
  key,
  displayName: key,
  description: null,
  nameProperty: 'name',
  createdAt: '',
  updatedAt: '',
})
const relation = (
  key: string,
  source: string,
  target: string,
  parent: RelationType['parent'] = null,
): RelationType => ({
  relationTypeId: `rt-${key}`,
  key,
  displayName: key,
  description: null,
  sourceEntityTypeKey: source,
  targetEntityTypeKey: target,
  parent,
  createdAt: '',
  updatedAt: '',
})

const schema = {
  entityTypes: ['person', 'team', 'project', 'skill', 'policy'].map(entity),
  relationTypes: [
    relation('member_of', 'person', 'team'),
    relation('works_on', 'person', 'project'),
    relation('requires', 'project', 'skill'),
    relation('manages', 'person', 'person'),
  ],
}

const sorted = (s: Set<string> | null) => (s === null ? null : [...s].sort())

test('an entity type keeps itself and its one-hop neighbours', () => {
  assert.deepEqual(sorted(focusSet(schema, { kind: 'entity-types', key: 'person' })), [
    'et-person',
    'et-project',
    'et-team',
  ])
  // Incoming and outgoing relation types both count.
  assert.deepEqual(sorted(focusSet(schema, { kind: 'entity-types', key: 'project' })), [
    'et-person',
    'et-project',
    'et-skill',
  ])
})

test('a self-loop adds nothing but the type itself', () => {
  const loopOnly = { entityTypes: schema.entityTypes, relationTypes: [relation('manages', 'person', 'person')] }
  assert.deepEqual(sorted(focusSet(loopOnly, { kind: 'entity-types', key: 'person' })), ['et-person'])
})

test('an entity type without relation types is alone', () => {
  assert.deepEqual(sorted(focusSet(schema, { kind: 'entity-types', key: 'policy' })), ['et-policy'])
})

test('a relation type keeps its two endpoints', () => {
  assert.deepEqual(sorted(focusSet(schema, { kind: 'relation-types', key: 'requires' })), ['et-project', 'et-skill'])
  assert.deepEqual(sorted(focusSet(schema, { kind: 'relation-types', key: 'manages' })), ['et-person'])
})

test('no or an unknown selection gives null', () => {
  assert.equal(focusSet(schema, null), null)
  assert.equal(focusSet(schema, { kind: 'entity-types', key: 'nope' }), null)
  assert.equal(focusSet(schema, { kind: 'relation-types', key: 'nope' }), null)
})

test('the hierarchy set holds the types joined by parent relation types', () => {
  const flagged = {
    entityTypes: schema.entityTypes,
    relationTypes: [
      relation('member_of', 'person', 'team', 'target'),
      relation('works_on', 'person', 'project'),
      relation('requires', 'project', 'skill', 'source'),
    ],
  }
  assert.deepEqual(sorted(hierarchySet(flagged)), ['et-person', 'et-project', 'et-skill', 'et-team'])
})

test('a parent self-relation keeps its one type; no parent relation keeps none', () => {
  const loop = { entityTypes: schema.entityTypes, relationTypes: [relation('manages', 'person', 'person', 'source')] }
  assert.deepEqual(sorted(hierarchySet(loop)), ['et-person'])
  assert.deepEqual(sorted(hierarchySet(schema)), [])
})
