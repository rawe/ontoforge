import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../src/api/http.ts'
import { fieldErrorsOf } from '../src/components/studio/modeling/errors.ts'

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
