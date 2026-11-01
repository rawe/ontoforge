import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SearchIndexDefinition } from '../src/api/types.ts'
import { aiMarks, applyFill, changedFields, sameNested, undoFill, withoutEdited } from '../src/assistants/draft/draftFillModel.ts'
import { DRAFT_VIEWS, draftViewOf, proposedLabels } from '../src/assistants/draft/drafters.ts'
import { groupLine, indexDiffValue, indexFields, withIndexFields } from '../src/components/search/indexDraft.ts'

const draft: SearchIndexDefinition = {
  key: 'people', name: 'People', description: 'People by name', entityType: 'person', fields: ['name', 'bio'], header: null,
  relations: [], semantic: { enabled: true, template: null }, keyword: { enabled: true },
}
const works = { relationType: 'works_for', direction: 'outgoing' as const, fields: ['role'], target: { company: ['name'] }, label: 'Employment', template: null }

test('the index editor fills nested parts and counts the order of fields', () => {
  const current = indexFields(draft)
  const proposed = { relations: [works], fields: ['bio', 'name'], semantic: { enabled: true, template: null } }
  assert.deepEqual(changedFields(current, proposed, sameNested), ['relations', 'fields'])
  const { fields, edit } = applyFill(current, proposed, {}, sameNested)
  assert.deepEqual(fields.relations, [works])
  assert.deepEqual(Object.keys(edit), ['relations', 'fields'])
  assert.deepEqual(withIndexFields(draft, fields).fields, ['bio', 'name'])
})

test('a copy of a filled value still counts as the AI value; an edited group drops the mark', () => {
  const current = indexFields(draft)
  const { fields, edit } = applyFill(current, { relations: [works] }, {}, sameNested)
  const copy = { ...fields, relations: [{ ...works }] }
  assert.deepEqual(Object.keys(aiMarks(copy, edit, sameNested)), ['relations'])
  const edited = { ...fields, relations: [{ ...works, fields: [] }] }
  assert.deepEqual(withoutEdited(edit, fields, edited, sameNested), {})
  assert.deepEqual(undoFill(copy, edit, sameNested).relations, [])
})

test('the diff shows each part in words', () => {
  assert.equal(indexDiffValue('header')(null), 'Name property')
  assert.equal(indexDiffValue('header')([]), 'None')
  assert.deepEqual(indexDiffValue('header')(['name', 'email']), ['name', 'email'])
  assert.deepEqual(indexDiffValue('relations')([works]), ['works_for (outgoing) · fields: role · company: name · label: Employment'])
  assert.equal(indexDiffValue('semantic')({ enabled: true, template: '{name}, {bio}' }), 'On\nTemplate: {name}, {bio}')
  assert.equal(indexDiffValue('semantic')({ enabled: false, template: null }), 'Off')
  assert.equal(indexDiffValue('keyword')({ enabled: true }), 'On')
  assert.equal(indexDiffValue('name')('People'), 'People')
  assert.equal(groupLine({ ...works, fields: [], target: {}, label: '', template: 'At {target.name}.' }), 'works_for (outgoing) · template: At {target.name}.')
})

test('the search index card lists the parts a proposal fills', () => {
  const view = draftViewOf('searchIndex')!
  assert.equal(view.title, 'Search index draft')
  assert.deepEqual(proposedLabels(view, { relations: [], description: 'x' }), ['Description', 'Relation groups'])
  assert.equal(DRAFT_VIEWS.length, 2)
})
