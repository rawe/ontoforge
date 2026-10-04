import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editableRetrievalConfig, retrieverExecution } from '../src/components/ai/retrieverProfileState.ts'
import { readRetrievalStream } from '../src/api/retrievalPrototype.ts'
import { chatSavedRetriever, prepareSavedRetriever, saveRetriever } from '../src/api/retrievers.ts'

const config = { threshold: 0.3, buckets: [{ entityTypeKey: 'problem', searchFields: ['title'], answerFields: ['title'], conditions: [] }] }
const saved = { key: 'support', config, validation: { valid: true } }
const changed = { ...config, threshold: 0.7 }

test('only an unchanged saved profile runs, by its server key', () => {
  assert.equal(retrieverExecution(null, config).mode, 'blocked')
  assert.deepEqual(retrieverExecution(saved, structuredClone(config)), { mode: 'saved', key: 'support' })
})

test('editing a saved profile blocks execution until it is saved or discarded', () => {
  assert.equal(retrieverExecution(saved, changed).mode, 'blocked')
  assert.equal(saved.config.threshold, 0.3)
  assert.deepEqual(retrieverExecution(saved, config), { mode: 'saved', key: 'support' })
})

test('schema-invalid saved profiles cannot run, edited or not', () => {
  const invalid = { ...saved, validation: { valid: false } }
  assert.equal(retrieverExecution(invalid, config).mode, 'blocked')
  assert.equal(retrieverExecution(invalid, changed).mode, 'blocked')
})

test('editor preserves unavailable schema keys for repair and rejects malformed shapes', () => {
  const unavailable = { threshold: 0.3, buckets: [{ entityTypeKey: 'deleted_type', searchFields: ['deleted_field'], answerFields: ['deleted_field'], conditions: [] }] }
  assert.equal(editableRetrievalConfig(unavailable), true)
  assert.equal(unavailable.buckets[0].entityTypeKey, 'deleted_type')
  assert.equal(editableRetrievalConfig({ threshold: 0.3, buckets: [{}] }), false)
  assert.equal(editableRetrievalConfig({ threshold: 0.3, buckets: [null] }), false)
  assert.equal(editableRetrievalConfig({ ...config, buckets: [{ ...config.buckets[0], conditions: [null] }] }), false)
  assert.equal(editableRetrievalConfig({ ...config, buckets: [{ ...config.buckets[0], conditions: [{ id: 'bad', mode: 'hard', targetField: 'name', textFields: [], path: [null] }] }] }), false)
})

test('unsupported configuration versions and malformed saved shapes cannot run, even after a reviewed repair', () => {
  const unknownVersion = { ...saved, configVersion: 99 }
  assert.equal(retrieverExecution(unknownVersion, config).mode, 'blocked')
  assert.equal(retrieverExecution(unknownVersion, config, true).mode, 'blocked')
  const malformed = { ...saved, config: { threshold: 0.3, buckets: [null] } as unknown as typeof config }
  assert.equal(retrieverExecution(malformed, config).mode, 'blocked')
  assert.equal(retrieverExecution(malformed, config, true).mode, 'blocked')
})

function stream(events: unknown[]) {
  return new Response(events.map((event) => JSON.stringify(event)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } })
}

test('cancelled streams suppress buffered answer deltas and cannot complete a stale turn', async () => {
  const controller = new AbortController()
  const received: unknown[] = []
  await assert.rejects(readRetrievalStream(stream([
    { type: 'phase', phase: 'plan', status: 'start' },
    { type: 'delta', text: 'Stale text' },
    { type: 'final', reply: 'Stale text' },
  ]), (event) => { received.push(event); controller.abort() }, controller.signal), { name: 'AbortError' })
  assert.equal(received.length, 1)
})

test('interrupted answer streams do not become completed conversation context', async () => {
  await assert.rejects(readRetrievalStream(stream([{ type: 'delta', text: 'Partial answer' }]), () => {}, new AbortController().signal), /Connection closed/)
})

test('saved preparation and chat never send browser configuration to the runtime', async () => {
  const original = globalThis.fetch
  const requests: { path: string; body: unknown }[] = []
  globalThis.fetch = async (input, init) => {
    requests.push({ path: String(input), body: init?.body ? JSON.parse(String(init.body)) : null })
    return String(input).endsWith('/chat') ? stream([{ type: 'final', reply: 'Answer' }]) : new Response(JSON.stringify({ ready: true }), { headers: { 'content-type': 'application/json' } })
  }
  try {
    const controller = new AbortController()
    await prepareSavedRetriever('example', 'all', 'support', controller.signal)
    await chatSavedRetriever('example', 'all', 'support', { message: 'Question', history: [], turnToken: 'opaque' }, () => {}, controller.signal)
    assert.equal(requests[0].path, '/api/ontologies/example/runtime/lenses/all/retrievers/support/prepare')
    assert.equal(requests[0].body, null)
    assert.deepEqual(requests[1].body, { message: 'Question', history: [], turnToken: 'opaque' })
  } finally { globalThis.fetch = original }
})

test('editing with the reviewed export-shaped body does not leak its key into strict PUT payloads', async () => {
  const original = globalThis.fetch
  const reviewed = { key: 'support', name: 'Updated support', description: null, configVersion: 1 as const, config }
  let requestedPath = ''
  let sent: unknown
  globalThis.fetch = async (input, init) => {
    requestedPath = String(input)
    sent = JSON.parse(String(init?.body))
    // The real modeling route rejects export-only fields instead of stripping them.
    const rejected = Object.hasOwn(sent as object, 'key')
    return new Response(JSON.stringify(rejected ? { error: { code: 'VALIDATION_ERROR', message: 'Unrecognized key: key' } } : { key: 'support', retrieverConfigId: 'preserved-id' }), { status: rejected ? 422 : 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await saveRetriever('example', 'main', reviewed.key, reviewed)
    assert.equal(result.retrieverConfigId, 'preserved-id')
    assert.equal(requestedPath, '/api/ontologies/example/model/lenses/main/retrievers/support')
    assert.deepEqual(sent, { name: reviewed.name, description: reviewed.description, configVersion: 1, config })
  } finally { globalThis.fetch = original }
})
