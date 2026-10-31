import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH, focusFromId, focusId, focusLabel, panelSettings, schemaFocus,
} from '../src/assistants/panel/panelModel.ts'
import type { Focus } from '../src/assistants/types.ts'
import { forgetThread, rememberThread, rememberedThread, restoreThread, type ThreadOwner } from '../src/assistants/conversation/threadStore.ts'
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

test('a remembered thread of the whole ontology has its own key per principal beside the lens threads', () => {
  assert.equal(storageKeys.thread('o', 'main', 'agents', '_default'), 'of.thread.o.main.agents._default')
  assert.equal(storageKeys.thread('o', null, 'studio', '_default', null), 'of.thread.o.studio._default.@anonymous')
  assert.equal(storageKeys.thread('o', null, 'studio', '_default', 'u.1'), 'of.thread.o.studio._default.u.1')
  // A user id never reads as the anonymous scope.
  assert.equal(storageKeys.thread('o', null, 'studio', '_default', '@anonymous'), 'of.thread.o.studio._default.%40anonymous')
})

test('the Studio thread of A, then B, then A again: B restoring or forgetting its own never touches A\'s', async () => {
  const items = new Map<string, string>()
  const storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) }
  const original = { localStorage: globalThis.localStorage, fetch: globalThis.fetch }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  // The server knows only A's thread.
  globalThis.fetch = (async (url: string) => url.endsWith('/threads/tA')
    ? new Response(JSON.stringify({ threadId: 'tA', messages: [{ role: 'user', content: 'Hi' }] }), { headers: { 'content-type': 'application/json' } })
    : new Response(JSON.stringify({ error: { code: 'RESOURCE_NOT_FOUND', message: 'gone', details: { code: 'THREAD_NOT_FOUND' } } }), { status: 404, headers: { 'content-type': 'application/json' } })) as typeof fetch
  const owner = (principal: string | null): ThreadOwner => ({ ontologyKey: 'o', lensKey: null, kind: 'studio', assistantKey: '_default', principal })
  const signal = new AbortController().signal
  try {
    rememberThread(owner('A'), 'tA')
    // B (and the anonymous scope) find none of their own, so read nothing.
    assert.deepEqual(await restoreThread(owner('B'), signal), { threadId: null, messages: [], expired: false })
    assert.equal(rememberedThread(owner(null)), null)
    // B's own thread expires and is forgotten; "New conversation" forgets it too.
    rememberThread(owner('B'), 'tB')
    assert.equal((await restoreThread(owner('B'), signal)).expired, true)
    assert.equal(rememberedThread(owner('B')), null)
    rememberThread(owner('B'), 'tB2')
    forgetThread(owner('B'))
    // A comes back to its conversation.
    assert.deepEqual(await restoreThread(owner('A'), signal), { threadId: 'tA', messages: [{ role: 'user', content: 'Hi' }], expired: false })
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: original.localStorage, configurable: true })
    globalThis.fetch = original.fetch
  }
})
