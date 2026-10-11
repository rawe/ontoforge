import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { EntityType, PropertyDefinition, RelationType } from '../src/api/types.ts'
import { searchSchema } from '../src/components/studio/modeling/search.ts'

const entity = (key: string, displayName: string): EntityType => ({
  entityTypeId: `et-${key}`,
  key,
  displayName,
  description: null,
  nameProperty: 'name',
  createdAt: '',
  updatedAt: '',
})
const relation = (key: string, displayName: string, source: string, target: string): RelationType => ({
  relationTypeId: `rt-${key}`,
  key,
  displayName,
  description: null,
  sourceEntityTypeKey: source,
  targetEntityTypeKey: target,
  createdAt: '',
  updatedAt: '',
})
const property = (key: string, displayName: string): PropertyDefinition => ({
  propertyId: `p-${key}`,
  key,
  displayName,
  description: null,
  dataType: 'string',
  required: false,
  defaultValue: null,
})

const schema = {
  entityTypes: [entity('person', 'Person'), entity('team', 'Team'), entity('project', 'Project')],
  relationTypes: [relation('works_on', 'Works On', 'person', 'project'), relation('member_of', 'Member Of', 'person', 'team')],
  properties: {
    'et-person': [property('name', 'Name'), property('email', 'E-mail')],
    'et-team': [property('name', 'Name'), property('cost_center', 'Budget Owner')],
    'et-project': [property('budget', 'Budget')],
    'rt-works_on': [property('hours_per_week', 'Hours per week')],
    'rt-member_of': undefined,
  },
}

test('an empty or blank query is inactive and matches nothing', () => {
  for (const q of ['', '   ']) {
    const m = searchSchema(schema, q)
    assert.equal(m.active, false)
    assert.equal(m.entityIds.size + m.relationIds.size + m.propertyIds.size, 0)
  }
})

test('types match by key and by display name', () => {
  assert.deepEqual([...searchSchema(schema, 'works_').relationIds], ['rt-works_on'])
  assert.deepEqual([...searchSchema(schema, 'member of').relationIds], ['rt-member_of'])
  const byName = searchSchema(schema, 'proj')
  assert.deepEqual([...byName.entityIds], ['et-project'])
  assert.equal(byName.propertyIds.size, 0)
})

test('a property hit includes its owner', () => {
  const m = searchSchema(schema, 'budget')
  // `budget` by key on Project, "Budget Owner" by display name on Team.
  assert.deepEqual([...m.entityIds].sort(), ['et-project', 'et-team'])
  assert.deepEqual([...m.propertyIds].sort(), ['p-budget', 'p-cost_center'])
  assert.equal(m.relationIds.size, 0)
  assert.deepEqual([...searchSchema(schema, 'hours').relationIds], ['rt-works_on'])
})

test('matching is case-insensitive and trims the query', () => {
  const m = searchSchema(schema, '  EMAIL ')
  assert.equal(m.active, true)
  assert.deepEqual([...m.entityIds], ['et-person'])
  assert.deepEqual([...m.propertyIds], ['p-email'])
  assert.deepEqual([...searchSchema(schema, 'TEAM').entityIds], ['et-team'])
})
