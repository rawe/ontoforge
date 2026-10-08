import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fieldNames,
  groupPlaceholders,
  insertAt,
  notSelected,
  outlineLines,
  outlinePart,
  selfPlaceholders,
} from '../src/components/search/entryOutline.ts'
import { emptyDraft, type IndexSchemaEntityType } from '../src/components/search/searchIndexModel.ts'
import type { OutlinePart } from '../src/api/types.ts'

const person: IndexSchemaEntityType = {
  key: 'person', displayName: 'Person', nameProperty: 'name',
  properties: [
    { key: 'name', displayName: 'Name', dataType: 'string' },
    { key: 'bio', displayName: 'Bio', dataType: 'string' },
    { key: 'cv', displayName: 'CV', dataType: 'document' },
  ],
}

test('outlineLines splits lines into text and field tokens', () => {
  assert.deepEqual(outlineLines('Person: ⟦root.name⟧\nEmployment\n⟦relation.role⟧ at ⟦target.name⟧\n⟦passage⟧'), [
    [{ kind: 'text', text: 'Person: ' }, { kind: 'field', owner: 'root', key: 'name' }],
    [{ kind: 'text', text: 'Employment' }],
    [
      { kind: 'field', owner: 'relation', key: 'role' },
      { kind: 'text', text: ' at ' },
      { kind: 'field', owner: 'target', key: 'name' },
    ],
    [{ kind: 'passage' }],
  ])
})

test('outlinePart finds a part by kind and group', () => {
  const part = (partKind: OutlinePart['partKind'], groupNo: number | null) =>
    ({ partKind, groupNo }) as OutlinePart
  const outline = [part('self', null), part('relation', 0), part('relation', 1)]
  assert.equal(outlinePart(outline, 'relation', 1), outline[2])
  assert.equal(outlinePart(outline, 'self'), outline[0])
  assert.equal(outlinePart(outline, 'passage'), undefined)
  assert.equal(outlinePart(null, 'self'), undefined)
})

test('notSelected lists the text properties left out', () => {
  assert.deepEqual(notSelected(person.properties, ['name']).map((p) => p.key), ['bio'])
})

test('placeholders a template can resolve', () => {
  const draft = { ...emptyDraft('person'), fields: ['bio', 'cv'] }
  assert.deepEqual(selfPlaceholders(draft, person), ['{bio}', '{name}'])
  assert.deepEqual(selfPlaceholders({ ...draft, header: [] }, person), ['{bio}'])
  const group = {
    relationType: 'works_for', direction: 'outgoing' as const, fields: ['role', 'name'],
    target: { company: ['name'] }, label: null, template: null,
  }
  assert.deepEqual(groupPlaceholders(draft, person, group), ['{role}', '{name}', '{target.name}', '{bio}'])
})

test('insertAt replaces the selection', () => {
  assert.equal(insertAt('ab', '{x}', 1, 1), 'a{x}b')
  assert.equal(insertAt('abc', '{x}', 0, 2), '{x}c')
})

test('fieldNames names the far end of a relation to the same type the other one', () => {
  const company: IndexSchemaEntityType = { ...person, key: 'company', displayName: 'Company' }
  assert.deepEqual(fieldNames({ root: person, relation: undefined, target: company }, 'target', 'name'), {
    field: 'Name', owner: 'Company',
  })
  assert.deepEqual(fieldNames({ root: person, relation: undefined, target: person }, 'target', 'name'), {
    field: 'Name', owner: 'other Person',
  })
  assert.deepEqual(fieldNames({ root: person, relation: undefined, target: person }, 'root', 'bio').owner, 'Person')
})
