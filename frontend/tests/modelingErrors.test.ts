import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../src/api/http.ts'
import {
  fieldErrorsOf,
  ONE_PER_PAIR_RULES,
  refusalReport,
  relationRuleViolationsOf,
} from '../src/components/studio/modeling/errors.ts'

const validation = (details: Record<string, unknown>) =>
  new ApiError(422, 'VALIDATION_ERROR', 'Request validation failed', details)

test('details.fields passes through', () => {
  assert.deepEqual(fieldErrorsOf(validation({ fields: { key: 'Taken', displayName: 'Empty' } })), {
    key: 'Taken',
    displayName: 'Empty',
  })
})

test('request-shape errors map their path to a field name', () => {
  assert.deepEqual(
    fieldErrorsOf(validation({ errors: [{ path: '/key', message: 'Invalid string' }] })),
    { key: 'Invalid string' },
  )
})

test('a nested path uses its first segment', () => {
  assert.deepEqual(
    fieldErrorsOf(validation({ errors: [{ path: '/defaultValue/0', message: 'Expected string' }] })),
    { defaultValue: 'Expected string' },
  )
})

test('a root-level shape error names no field', () => {
  assert.deepEqual(fieldErrorsOf(validation({ errors: [{ path: '', message: 'Bad body' }] })), {})
})

test('details.fields wins over a shape error for the same field', () => {
  assert.deepEqual(
    fieldErrorsOf(
      validation({
        fields: { key: 'From the service' },
        errors: [
          { path: '/key', message: 'From the shape' },
          { path: '/dataType', message: 'Invalid enum' },
        ],
      }),
    ),
    { key: 'From the service', dataType: 'Invalid enum' },
  )
})

test('anything that is not an ApiError has no field errors', () => {
  assert.deepEqual(fieldErrorsOf(new Error('boom')), {})
  assert.deepEqual(fieldErrorsOf('boom'), {})
  assert.deepEqual(fieldErrorsOf(new ApiError(409, 'RESOURCE_CONFLICT', 'exists')), {})
})

const refused = (violations: unknown) =>
  new ApiError(409, 'RESOURCE_CONFLICT', 'breaks the parent rules', { violations })

test('relationRuleViolationsOf reads details.violations of a 409', () => {
  const violations = [{ rule: 'two_parents', count: 1, entities: [{ type: 'customer', id: 'c1' }] }]
  assert.deepEqual(relationRuleViolationsOf(refused(violations)), violations)
})

test('relationRuleViolationsOf is null for any other error', () => {
  assert.equal(relationRuleViolationsOf(new ApiError(409, 'RESOURCE_CONFLICT', 'exists')), null)
  assert.equal(relationRuleViolationsOf(refused('nope')), null)
  assert.equal(
    relationRuleViolationsOf(new ApiError(422, 'VALIDATION_ERROR', 'bad', { violations: [] })),
    null,
  )
  assert.equal(relationRuleViolationsOf(new Error('boom')), null)
})

test('refusalReport lists both rules in order, a rule without violators as none', () => {
  const report = refusalReport([
    { rule: 'cycle', count: 1, entities: [{ type: 'task', id: 't1' }] },
  ])
  assert.deepEqual(report, [
    { rule: 'two_parents', summary: 'Two parents · none', entities: [], more: 0 },
    { rule: 'cycle', summary: 'Cycles · 1 entity', entities: [{ type: 'task', id: 't1' }], more: 0 },
  ])
})

test('refusalReport lists the rules it is given, counting pairs for one per pair', () => {
  const report = refusalReport(
    [{ rule: 'duplicate_pair', count: 2, entities: [{ type: 'person', id: 'p1' }] }],
    ONE_PER_PAIR_RULES,
  )
  assert.deepEqual(report, [
    {
      rule: 'duplicate_pair',
      summary: 'Pairs linked more than once · 2 pairs',
      entities: [{ type: 'person', id: 'p1' }],
      more: 1,
    },
  ])
})

test('refusalReport counts the breaking entities beyond the five listed', () => {
  const entities = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ type: 'task', id }))
  const [twoParents] = refusalReport([{ rule: 'two_parents', count: 7, entities }])
  assert.equal(twoParents?.summary, 'Two parents · 7 entities')
  assert.equal(twoParents?.entities.length, 5)
  assert.equal(twoParents?.more, 2)
})
