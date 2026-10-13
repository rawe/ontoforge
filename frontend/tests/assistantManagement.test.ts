import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../src/api/http.ts'
import { assistantErrorLines, assistantKeyError, assistantStatus } from '../src/components/studio/assistants/assistantModel.ts'

test('status: new before the first save, then unsaved changes, then invalid, else saved', () => {
  assert.equal(assistantStatus({ isNew: true, dirty: true, invalid: true }), 'new')
  assert.equal(assistantStatus({ isNew: false, dirty: true, invalid: true }), 'dirty')
  assert.equal(assistantStatus({ isNew: false, dirty: false, invalid: true }), 'invalid')
  assert.equal(assistantStatus({ isNew: false, dirty: false, invalid: false }), 'saved')
})

test('a new key is refused when taken in the lens or longer than 64 characters', () => {
  assert.equal(assistantKeyError('team', ['team', 'other'], 'Navigator'), 'A navigator with this key exists already.')
  assert.equal(assistantKeyError('team', ['team'], 'Agent'), 'An agent with this key exists already.')
  assert.equal(assistantKeyError(`k${'x'.repeat(64)}`, [], 'Agent'), 'At most 64 characters.')
  assert.equal(assistantKeyError(`k${'x'.repeat(63)}`, ['team'], 'Agent'), undefined)
})

test('error lines: the server reasons first, plain or with their path', () => {
  const error = new ApiError(422, 'VALIDATION_ERROR', 'Invalid', { errors: ['Unknown relation type', { path: '/name', message: 'Required' }, { message: 'Bad' }] })
  assert.deepEqual(assistantErrorLines(error), ['Unknown relation type', '/name: Required', 'Bad'])
})

test('error lines: field errors when there are no reasons, else the message', () => {
  assert.deepEqual(assistantErrorLines(new ApiError(422, 'VALIDATION_ERROR', 'Invalid', { fields: { key: 'Taken' } })), ['key: Taken'])
  assert.deepEqual(assistantErrorLines(new ApiError(409, 'CONFLICT', 'Key taken')), ['Key taken'])
  assert.deepEqual(assistantErrorLines(new Error('offline')), ['offline'])
  assert.deepEqual(assistantErrorLines('nope'), ['The request failed.'])
})
