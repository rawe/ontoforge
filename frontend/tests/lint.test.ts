import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { EntityType, PropertyDefinition, RelationType } from '../src/api/types.ts'
import { lintSchema } from '../src/components/studio/modeling/lint.ts'

const entity = (key: string, description: string | null = 'Described'): EntityType => ({
  entityTypeId: `et-${key}`,
  key,
  displayName: key,
  description,
  nameProperty: 'name',
  createdAt: '',
  updatedAt: '',
})
const relation = (key: string, source: string, target: string, description: string | null = 'Described'): RelationType => ({
  relationTypeId: `rt-${key}`,
  key,
  displayName: key,
  description,
  sourceEntityTypeKey: source,
  targetEntityTypeKey: target,
  createdAt: '',
  updatedAt: '',
})
const property = (id: string, key: string, description: string | null = 'Described'): PropertyDefinition => ({
  propertyId: id,
  key,
  displayName: key,
  description,
  dataType: 'string',
  required: false,
  defaultValue: null,
})

const named = (prefix: string) => [property(`${prefix}-name`, 'name'), property(`${prefix}-email`, 'email')]

test('a fully described, connected schema has no issues', () => {
  const schema = {
    entityTypes: [entity('person'), entity('team')],
    relationTypes: [relation('member_of', 'person', 'team')],
    properties: { 'et-person': named('p'), 'et-team': named('t'), 'rt-member_of': [] },
  }
  assert.deepEqual(lintSchema(schema), [])
})

test('a missing or blank description is reported for types and properties', () => {
  const schema = {
    entityTypes: [entity('person', null), entity('team', '   ')],
    relationTypes: [relation('member_of', 'person', 'team', '')],
    properties: {
      'et-person': [property('p-name', 'name'), property('p-email', 'email', ' ')],
      'et-team': named('t'),
      'rt-member_of': [property('m-since', 'since', null)],
    },
  }
  const ids = lintSchema(schema).map((i) => i.id)
  assert.deepEqual(ids.sort(), ['desc:e:et-person', 'desc:e:et-team', 'desc:p:m-since', 'desc:p:p-email', 'desc:r:rt-member_of'])
})

test('an entity type no relation type uses is isolated; a self-loop counts as use', () => {
  const schema = {
    entityTypes: [entity('person'), entity('policy'), entity('vendor')],
    relationTypes: [relation('supersedes', 'policy', 'policy')],
    properties: { 'et-person': named('p'), 'et-policy': named('o'), 'et-vendor': named('v'), 'rt-supersedes': [] },
  }
  const isolated = lintSchema(schema).filter((i) => i.kind === 'isolated')
  assert.deepEqual(
    isolated.map((i) => i.target),
    [
      { kind: 'entity-types', key: 'person' },
      { kind: 'entity-types', key: 'vendor' },
    ],
  )
})

test('an entity type with at most one property has only the name property; unloaded lists are skipped', () => {
  const schema = {
    entityTypes: [entity('a'), entity('b'), entity('c'), entity('d')],
    relationTypes: [relation('r1', 'a', 'b'), relation('r2', 'c', 'd')],
    properties: {
      'et-a': [property('a-name', 'name')],
      'et-b': [],
      'et-c': named('c'),
      'et-d': undefined,
      'rt-r1': [],
      'rt-r2': [],
    },
  }
  const onlyName = lintSchema(schema).filter((i) => i.kind === 'only-name')
  assert.deepEqual(
    onlyName.map((i) => i.id),
    ['name:et-a', 'name:et-b'],
  )
})

test('property issues carry the property and an owner.key subject', () => {
  const schema = {
    entityTypes: [entity('person')],
    relationTypes: [relation('knows', 'person', 'person')],
    properties: {
      'et-person': [property('p-name', 'name'), property('p-email', 'email', null)],
      'rt-knows': [property('k-since', 'since', null)],
    },
  }
  const props = lintSchema(schema).filter((i) => i.propertyId !== undefined)
  assert.deepEqual(
    props.map((i) => ({ id: i.id, typeId: i.typeId, propertyKey: i.propertyKey, subject: i.subject, target: i.target })),
    [
      {
        id: 'desc:p:p-email',
        typeId: 'et-person',
        propertyKey: 'email',
        subject: 'person.email',
        target: { kind: 'entity-types', key: 'person' },
      },
      {
        id: 'desc:p:k-since',
        typeId: 'rt-knows',
        propertyKey: 'since',
        subject: 'knows.since',
        target: { kind: 'relation-types', key: 'knows' },
      },
    ],
  )
})

test('issue ids are stable across runs and unique', () => {
  const schema = {
    entityTypes: [entity('person', null), entity('vendor', null)],
    relationTypes: [relation('knows', 'person', 'person', null)],
    properties: { 'et-person': [property('p-name', 'name', null)], 'et-vendor': [], 'rt-knows': [] },
  }
  const first = lintSchema(schema).map((i) => i.id)
  assert.deepEqual(lintSchema(structuredClone(schema)).map((i) => i.id), first)
  assert.equal(new Set(first).size, first.length)
})
