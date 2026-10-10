import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { EntityType } from '../src/api/types.ts'
import { missingEnds, parseQuickRelation } from '../src/components/studio/modeling/quickCreate.ts'

const entity = (key: string, displayName: string): EntityType => ({
  entityTypeId: `et-${key}`,
  key,
  displayName,
  description: null,
  nameProperty: 'name',
  createdAt: '',
  updatedAt: '',
})

const types = [
  entity('person', 'Person'),
  entity('skill', 'Skill'),
  entity('org', 'Company'),
  entity('policy_document', 'Policy Document'),
]

test('arrow syntax: source -name-> target', () => {
  const q = parseQuickRelation('skill -taught_by-> mentor', types)
  assert.ok(q !== null)
  assert.equal(q.source.key, 'skill')
  assert.equal(q.source.existing?.entityTypeId, 'et-skill')
  assert.equal(q.target.key, 'mentor')
  assert.equal(q.key, 'taught_by')
  assert.equal(q.displayName, 'Taught By')
  // Longer arrows and a name with spaces.
  const spaced = parseQuickRelation('  person --works with-->  skill ', types)
  assert.equal(spaced?.key, 'works_with')
  assert.equal(spaced?.displayName, 'Works With')
  assert.equal(spaced?.target.key, 'skill')
})

test('plain syntax: source name target', () => {
  const q = parseQuickRelation('person mentors intern', types)
  assert.ok(q !== null)
  assert.equal(q.source.key, 'person')
  assert.equal(q.key, 'mentors')
  assert.equal(q.displayName, 'Mentors')
  assert.equal(q.target.key, 'intern')
})

test('endpoints match by key and by display name, case-insensitively, or by the derived key', () => {
  const byKey = parseQuickRelation('PERSON knows SKILL', types)
  assert.equal(byKey?.source.existing?.key, 'person')
  assert.equal(byKey?.target.existing?.key, 'skill')
  const byName = parseQuickRelation('person works_at COMPANY', types)
  assert.equal(byName?.target.existing?.key, 'org')
  assert.equal(byName?.target.key, 'org')
  const byDerived = parseQuickRelation('Person cites Policy-Document', types)
  assert.equal(byDerived?.target.existing?.key, 'policy_document')
  assert.equal(byDerived?.target.token, 'Policy-Document')
})

test('an unknown endpoint has no existing type and the derived key', () => {
  const q = parseQuickRelation('person -mentors-> New-Hire', types)
  assert.equal(q?.target.existing, null)
  assert.equal(q?.target.key, 'new_hire')
  assert.equal(q?.target.token, 'New-Hire')
  assert.deepEqual(q === null ? [] : missingEnds(q).map((e) => e.key), ['new_hire'])
})

test('a self-relation names its endpoint twice and creates it once', () => {
  const known = parseQuickRelation('person manages person', types)
  assert.equal(known?.source.key, 'person')
  assert.equal(known?.target.key, 'person')
  assert.deepEqual(known === null ? [] : missingEnds(known), [])
  const unknown = parseQuickRelation('Intern -mentors-> intern', types)
  assert.deepEqual(unknown === null ? [] : missingEnds(unknown).map((e) => e.key), ['intern'])
})

test('input that is no relation line, or whose name has no valid key, is rejected', () => {
  for (const input of ['', 'person', 'person knows', 'add property to person now', 'person -> skill', 'person 12 skill']) {
    assert.equal(parseQuickRelation(input, types), null, input)
  }
  assert.equal(parseQuickRelation('person -123-> skill', types), null)
  assert.equal(parseQuickRelation('person -__-> skill', types), null)
})
