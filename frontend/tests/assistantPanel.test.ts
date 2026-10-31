import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH, focusFromId, focusId, focusLabel, panelSettings, schemaFocus,
} from '../src/assistants/panel/panelModel.ts'
import type { Focus } from '../src/assistants/types.ts'
import { storageKeys } from '../src/lib/storage.ts'

test('the schema page publishes the opened property, else the selected type, else nothing', () => {
  assert.equal(schemaFocus(null, 'email'), null)
  assert.deepEqual(schemaFocus({ kind: 'entity-types', key: 'person' }, null), { kind: 'entityType', key: 'person' })
  assert.deepEqual(schemaFocus({ kind: 'relation-types', key: 'works_at' }, null), { kind: 'relationType', key: 'works_at' })
  assert.deepEqual(schemaFocus({ kind: 'entity-types', key: 'person' }, 'email'), { kind: 'property', key: 'email', typeKey: 'person' })
})

test('a focus id stands for its content and reads back to the same focus', () => {
  const foci: Focus[] = [
    { kind: 'entityType', key: 'person' },
    { kind: 'property', key: 'email', typeKey: 'person' },
    { kind: 'agent', key: 'support', lensKey: 'main' },
  ]
  for (const focus of foci) assert.deepEqual(focusFromId(focusId(focus)!), focus)
  assert.equal(focusId({ kind: 'lens', key: 'main' }), focusId({ key: 'main', kind: 'lens' }))
  assert.notEqual(focusId({ kind: 'entityType', key: 'x' }), focusId({ kind: 'relationType', key: 'x' }))
  assert.equal(focusId(null), null)
})

test('the focus chip names the item by key, a property with its type, and what it is', () => {
  assert.deepEqual(focusLabel({ kind: 'entityType', key: 'person' }), { name: 'person', what: 'entity type' })
  assert.deepEqual(focusLabel({ kind: 'property', key: 'email', typeKey: 'person' }), { name: 'person.email', what: 'property' })
  assert.deepEqual(focusLabel({ kind: 'lens', key: 'main' }), { name: 'main', what: 'lens' })
  assert.deepEqual(focusLabel({ kind: 'agent', key: 'support', lensKey: 'main' }), { name: 'main.support', what: 'agent' })
})

test('the remembered panel starts closed at its default width; a width stays within its bounds', () => {
  assert.deepEqual(panelSettings(null), { open: false, width: DEFAULT_WIDTH })
  assert.deepEqual(panelSettings({ open: 'yes', width: 'wide' }), { open: false, width: DEFAULT_WIDTH })
  assert.deepEqual(panelSettings({ open: true, width: 10 }), { open: true, width: MIN_WIDTH })
  assert.deepEqual(panelSettings({ open: true, width: 5000 }), { open: true, width: MAX_WIDTH })
  assert.deepEqual(panelSettings({ open: true, width: 512.4 }), { open: true, width: 512 })
})

test('a remembered thread of the whole ontology has its own key beside the lens threads', () => {
  assert.equal(storageKeys.thread('o', 'main', 'agents', '_default'), 'of.thread.o.main.agents._default')
  assert.equal(storageKeys.thread('o', null, 'studio', '_default'), 'of.thread.o.studio._default')
})
