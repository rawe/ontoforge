import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hidesNameProperty,
  indexInclusionState,
  managedIndexKeysFor,
  orderByRootType,
} from '../src/components/studio/scopeModel.ts'
import type { IndexKind, SearchIndexRecord } from '../src/api/types.ts'

const record = (key: string, kind: IndexKind, entityType: string, enabled = true): SearchIndexRecord => ({
  key, kind, enabled,
  definition: {
    key, name: key, description: '', entityType, fields: [], header: null, relations: [],
    semantic: { enabled: true, template: null }, keyword: { enabled: true },
  },
  documentProperty: null,
  status: { state: 'ready', representations: [], lastErrors: [] },
  createdAt: '', updatedAt: '',
})

const records = [
  record('company~default', 'default', 'company'),
  record('person_employment', 'custom', 'person'),
  record('person~bio', 'passage', 'person'),
  record('person~default', 'default', 'person', false),
]

test('an include hides the name property only with an explicit list lacking it', () => {
  assert.equal(hidesNameProperty(undefined, 'name'), false)
  assert.equal(hidesNameProperty({ key: 'person', properties: null }, 'name'), false)
  assert.equal(hidesNameProperty({ key: 'person', properties: ['name', 'bio'] }, 'name'), false)
  assert.equal(hidesNameProperty({ key: 'person', properties: ['bio'] }, 'name'), true)
  assert.equal(hidesNameProperty({ key: 'person', properties: [] }, 'title'), true)
})

test('including a type pre-selects its default and passage indices, switched-off ones too', () => {
  assert.deepEqual(managedIndexKeysFor(records, 'person'), ['person~bio', 'person~default'])
  assert.deepEqual(managedIndexKeysFor(records, 'company'), ['company~default'])
  assert.deepEqual(managedIndexKeysFor(records, 'nobody'), [])
})

test('an index can be ticked only when its root type is in scope', () => {
  const person = records[1]!
  assert.deepEqual(indexInclusionState(person, new Set(), new Set(['person'])), {
    included: false, canInclude: true,
  })
  assert.deepEqual(indexInclusionState(person, new Set(), new Set(['company'])), {
    included: false, canInclude: false,
  })
})

test('an included index whose root left the scope stays included and is flagged', () => {
  const person = records[1]!
  assert.deepEqual(indexInclusionState(person, new Set(['person_employment']), new Set()), {
    included: true, rootMissing: true,
  })
  assert.deepEqual(
    indexInclusionState(person, new Set(['person_employment']), new Set(['person'])),
    { included: true, rootMissing: false },
  )
})

test('indices are listed by root type in schema order, then by key; unknown roots last', () => {
  const ordered = orderByRootType(
    [...records, record('ghost~default', 'default', 'ghost')],
    ['person', 'company'],
  ).map((r) => r.key)
  assert.deepEqual(ordered, [
    'person_employment', 'person~bio', 'person~default', 'company~default', 'ghost~default',
  ])
})
