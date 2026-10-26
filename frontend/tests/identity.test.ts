import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkEntities } from '../src/api/entities.ts'
import { ApiError } from '../src/api/http.ts'
import {
  identityEligible,
  identityExample,
  identityReport,
  identityViolationsOf,
} from '../src/components/studio/modeling/identity.ts'

test('only string, integer and date properties may be part of an identity', () => {
  assert.deepEqual(
    (['string', 'integer', 'date', 'float', 'boolean', 'datetime', 'document'] as const).map(identityEligible),
    [true, true, true, false, false, false, false],
  )
})

test('the example joins a sample of each part in order with ~', () => {
  assert.equal(
    identityExample([
      { key: 'code', dataType: 'string' },
      { key: 'year', dataType: 'integer' },
      { key: 'start', dataType: 'date' },
    ]),
    'CODE~42~2024-01-31',
  )
  assert.equal(identityExample([]), '')
})

const refused = (violations: unknown) =>
  new ApiError(409, 'RESOURCE_CONFLICT', 'stored data cannot take the identity', { violations })

test('a refusal by the stored data reads as one line per rule, in a fixed order', () => {
  const violations = identityViolationsOf(
    refused([
      { rule: 'duplicate', count: 7, entities: [{ type: 'task', id: 'a' }, { type: 'task', id: 'b' }] },
      { rule: 'missing_value', count: 1, entities: [{ type: 'task', id: 'c' }] },
    ]),
  )
  assert.notEqual(violations, null)
  assert.deepEqual(
    identityReport(violations!).map((line) => [line.rule, line.summary, line.more]),
    [
      ['missing_value', 'Without a value (or with an empty one) · 1 entity', 0],
      ['duplicate', 'Sharing an identity · 7 entities', 5],
    ],
  )
})

test('other errors are no identity refusal', () => {
  assert.equal(identityViolationsOf(new Error('boom')), null)
  assert.equal(identityViolationsOf(refused([{ rule: 'two_parents', count: 1, entities: [] }])), null)
  assert.equal(identityViolationsOf(new ApiError(422, 'VALIDATION_ERROR', 'bad', { violations: [] })), null)
})

test('IDENTITY_TAKEN names the identity and maps to a field error per identity property', () => {
  const taken = new ApiError(409, 'RESOURCE_CONFLICT', 'taken', {
    code: 'IDENTITY_TAKEN',
    identity: 'A-1~2024',
    properties: ['code', 'year'],
  })
  assert.deepEqual(taken.identityTaken, { identity: 'A-1~2024', properties: ['code', 'year'] })
  const message = "Another entity of this type already has the identity 'A-1~2024'"
  assert.deepEqual(taken.identityTakenFields, { code: message, year: message })

  const other = new ApiError(409, 'RESOURCE_CONFLICT', 'exists')
  assert.equal(other.identityTaken, null)
  assert.equal(other.identityTakenFields, undefined)
})

test('an assistant card may carry an identity, as text', () => {
  const card = { ref: 'e1', id: 'x', type: 'task', typeName: 'Task', label: 'T', fields: [], evidence: true }
  assert.doesNotThrow(() => checkEntities({ entities: [{ ...card, identity: 'T-1' }], links: [] }, new Set()))
  assert.doesNotThrow(() => checkEntities({ entities: [card], links: [] }, new Set()))
  assert.throws(() => checkEntities({ entities: [{ ...card, identity: 7 }], links: [] }, new Set()))
})
