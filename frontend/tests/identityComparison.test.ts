import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareSequentially, identitySnapshot } from '../src/components/ai/identityComparisonModel.ts'
import type { SchemaProperty } from '../src/api/types.ts'

const property = (key: string, dataType: SchemaProperty['dataType'] = 'string'): SchemaProperty =>
  ({ key, dataType, displayName: key, description: null, required: false, defaultValue: null })

test('identity snapshots remove IDs, documents, unknown fields and nonscalar values', () => {
  assert.deepEqual(identitySnapshot([
    property('name'), property('active', 'boolean'), property('age', 'integer'),
    property('notes', 'document'), property('_id'), property('nested'), property('invalid', 'float'),
  ], { name: 'Acme', active: false, age: 0, notes: 'Secret document', _id: 'identifier',
    other: 'hidden field', nested: { name: 'nested' }, invalid: Infinity }),
  { name: 'Acme', active: false, age: 0 })
})

test('missing fields stay missing while explicit null is retained', () => {
  assert.deepEqual(identitySnapshot([property('name'), property('city')], { name: null }), { name: null })
})

test('comparison is sequential and bounded to three candidates, preserving candidate order', async () => {
  let concurrent = 0
  const calls: number[] = []
  const results: number[] = []
  await compareSequentially([1, 2, 3, 4], new AbortController().signal, async (candidate) => {
    assert.equal(concurrent++, 0)
    calls.push(candidate)
    await Promise.resolve()
    concurrent--
    return candidate * 10
  }, (_, result) => results.push(result))
  assert.deepEqual(calls, [1, 2, 3])
  assert.deepEqual(results, [10, 20, 30])
})

test('cancellation suppresses a late result and stops later candidate calls', async () => {
  const controller = new AbortController()
  const calls: number[] = []
  const results: number[] = []
  await compareSequentially([1, 2, 3], controller.signal, async (candidate) => {
    calls.push(candidate)
    controller.abort()
    return candidate
  }, (_, result) => results.push(result))
  assert.deepEqual(calls, [1])
  assert.deepEqual(results, [])
})

test('provider failure stops subsequent calls but retains already delivered results', async () => {
  const calls: number[] = []
  const results: number[] = []
  await assert.rejects(compareSequentially([1, 2, 3], new AbortController().signal, async (candidate) => {
    calls.push(candidate)
    if (candidate === 2) throw new Error('Provider unavailable')
    return candidate
  }, (_, result) => results.push(result)), /Provider unavailable/)
  assert.deepEqual(calls, [1, 2])
  assert.deepEqual(results, [1])
})
