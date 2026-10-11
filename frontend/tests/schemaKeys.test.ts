import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_NAME_KEY,
  MAX_KEY_LENGTH,
  dataTypesFor,
  deriveKey,
  humanize,
  keyProblem,
  keyProblemAmong,
  nameKeyValid,
  withName,
} from '../src/components/studio/modeling/schemaKeys.ts'

test('deriveKey snake-cases a display name', () => {
  assert.equal(deriveKey('Vehicle Owner'), 'vehicle_owner')
  assert.equal(deriveKey('  Start-Date (UTC) '), 'start_date_utc')
})

test('deriveKey drops every leading digit and underscore', () => {
  assert.equal(deriveKey('12 Monkeys'), 'monkeys')
  assert.equal(deriveKey('__Hello__'), 'hello')
  assert.equal(deriveKey('1_2_3 go'), 'go')
  assert.equal(deriveKey('42'), '')
})

test('deriveKey collapses non-ASCII characters to underscores', () => {
  assert.equal(deriveKey('Größe Wert'), 'gr_e_wert')
  assert.equal(deriveKey('Café'), 'caf')
})

test('deriveKey caps the key at the maximum length', () => {
  const key = deriveKey('a'.repeat(70))
  assert.equal(key.length, MAX_KEY_LENGTH)
  assert.equal(MAX_KEY_LENGTH, 64)
  // A cut right after a separator leaves no trailing underscore.
  assert.equal(deriveKey(`${'a'.repeat(63)} bcd`), 'a'.repeat(63))
})

test('keyProblem flags empty, malformed and too long keys', () => {
  assert.equal(keyProblem('valid_key_2'), null)
  assert.match(keyProblem('') ?? '', /required/)
  assert.match(keyProblem('Bad-Key') ?? '', /Lowercase/)
  assert.match(keyProblem('1abc') ?? '', /start with a letter/)
  assert.match(keyProblem('a'.repeat(65)) ?? '', /At most 64/)
  assert.equal(keyProblem('a'.repeat(64)), null)
})

test('keyProblemAmong adds uniqueness', () => {
  assert.equal(keyProblemAmong('fresh', ['taken']), null)
  assert.equal(keyProblemAmong('taken', ['taken']), '"taken" already exists.')
  assert.match(keyProblemAmong('', ['taken']) ?? '', /required/)
})

test('humanize turns a key into a display name', () => {
  assert.equal(humanize('works_on'), 'Works On')
  assert.equal(humanize('reports-to__boss'), 'Reports To Boss')
})

test('dataTypesFor offers document on entity types only', () => {
  assert.ok(dataTypesFor('entity-types').includes('document'))
  assert.ok(!dataTypesFor('relation-types').includes('document'))
  assert.deepEqual(
    dataTypesFor('relation-types'),
    ['string', 'integer', 'float', 'boolean', 'date', 'datetime'],
  )
})

test('a key follows the display name until it is edited', () => {
  const typed = withName(EMPTY_NAME_KEY, 'Start Date')
  assert.deepEqual(typed, { name: 'Start Date', key: 'start_date', keyTouched: false })
  assert.equal(nameKeyValid(typed), true)
  const edited = { ...typed, key: 'begins', keyTouched: true }
  assert.equal(withName(edited, 'Start Day').key, 'begins')
  assert.equal(nameKeyValid({ ...typed, name: '  ' }), false)
  assert.equal(nameKeyValid(withName(EMPTY_NAME_KEY, '42')), false)
})
