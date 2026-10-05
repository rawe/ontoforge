import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayLabel, nameProperties, nameValue } from '../src/lib/displayLabel.ts'
import type { EntityInstance, RuntimeSchema, SchemaEntityType } from '../src/api/types.ts'

const entity = (props: Record<string, EntityInstance[string]>): EntityInstance => ({
  _id: '0123456789abcdef', _entityTypeKey: 'person', _createdAt: '', _updatedAt: '', ...props,
})

test('the label is the name property value', () => {
  assert.equal(displayLabel(entity({ name: 'Ada', title: 'Countess' }), 'name'), 'Ada')
  assert.equal(displayLabel(entity({ name: 'Ada', title: 'Countess' }), 'title'), 'Countess')
})

test('no fallback to other string properties: empty or missing name gives the truncated _id', () => {
  const id = '0123456789ab'
  assert.equal(displayLabel(entity({ name: '  ', title: 'Countess' }), 'name'), id)
  assert.equal(displayLabel(entity({ title: 'Countess' }), 'name'), id)
  assert.equal(displayLabel(entity({ name: 42 }), 'name'), id)
})

test('a hidden or unknown name property gives the truncated _id', () => {
  assert.equal(displayLabel(entity({ name: 'Ada' }), null), '0123456789ab')
  assert.equal(displayLabel(entity({ name: 'Ada' }), undefined), '0123456789ab')
})

test('nameValue reads a property bag and returns null when there is no name', () => {
  assert.equal(nameValue({ label: 'Widget' }, 'label'), 'Widget')
  assert.equal(nameValue({ label: '' }, 'label'), null)
  assert.equal(nameValue({ label: 'Widget' }, null), null)
})

test('nameProperties maps entity type keys to their name property', () => {
  const type = (key: string, nameProperty: string | null): SchemaEntityType =>
    ({ key, displayName: key, description: null, nameProperty, properties: [] })
  const schema = { entityTypes: [type('person', 'name'), type('doc', null)] } as unknown as RuntimeSchema
  const names = nameProperties(schema)
  assert.equal(names.get('person'), 'name')
  assert.equal(names.get('doc'), null)
  assert.equal(names.get('missing'), undefined)
  assert.equal(nameProperties(undefined).size, 0)
})
