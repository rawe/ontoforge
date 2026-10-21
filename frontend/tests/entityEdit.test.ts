import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SchemaProperty } from '../src/api/types.ts'
import { changedProperties, editPatch } from '../src/components/quickadd/entityEdit.ts'

const prop = (key: string, dataType: SchemaProperty['dataType'] = 'string'): SchemaProperty => ({
  key,
  displayName: key,
  description: null,
  dataType,
  required: false,
  defaultValue: null,
})

test('changedProperties keeps only the properties whose draft changed', () => {
  const properties = [prop('name'), prop('budget', 'integer'), prop('notes', 'document'), prop('phase')]
  const initial = { name: 'P9', budget: '5', notes: '', phase: 'a' }
  const drafts = { name: 'P9b', budget: '5', notes: '', phase: '' }
  assert.deepEqual(
    changedProperties(properties, initial, drafts).map((p) => p.key),
    ['name', 'phase'],
  )
})

test('editPatch sends the changed values, a cleared one as null', () => {
  const changed = [prop('name'), prop('phase'), prop('budget', 'integer')]
  assert.deepEqual(editPatch(changed, { name: 'P9b', budget: 7 }), { name: 'P9b', phase: null, budget: 7 })
  assert.deepEqual(editPatch([], { name: 'P9b' }), {})
})
