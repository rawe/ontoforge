import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  countFields,
  draftProblems,
  emptyDraft,
  formatDuration,
  headerMode,
  issuesAt,
  managedByEntityType,
  MAX_INDEX_FIELDS,
  ownFieldOptions,
  relationGroupOptions,
  sameDefinition,
  selectedDocument,
  statusChip,
  toDefinition,
  toggleDisabledIndex,
  toggleKey,
  toggleKeywordLanguage,
  toPreviewInput,
  withEntityType,
  type IndexSchema,
} from '../src/components/search/searchIndexModel.ts'
import type { IndexStatus, SearchIndexDefinition, SearchIndexRecord } from '../src/api/types.ts'

const schema: IndexSchema = {
  entityTypes: [
    {
      key: 'person', displayName: 'Person', nameProperty: 'name',
      properties: [
        { key: 'name', displayName: 'Name', dataType: 'string' },
        { key: 'age', displayName: 'Age', dataType: 'integer' },
        { key: 'bio', displayName: 'Bio', dataType: 'document' },
        { key: 'cv', displayName: 'CV', dataType: 'document' },
      ],
    },
    { key: 'company', displayName: 'Company', nameProperty: 'name', properties: [{ key: 'name', displayName: 'Name', dataType: 'string' }] },
  ],
  relationTypes: [
    { key: 'works_for', displayName: 'Works for', sourceEntityTypeKey: 'person', targetEntityTypeKey: 'company', properties: [] },
    { key: 'knows', displayName: 'Knows', sourceEntityTypeKey: 'person', targetEntityTypeKey: 'person', properties: [] },
    { key: 'owns', displayName: 'Owns', sourceEntityTypeKey: 'company', targetEntityTypeKey: 'company', properties: [] },
  ],
}

const draft = (patch: Partial<SearchIndexDefinition> = {}): SearchIndexDefinition => ({
  ...emptyDraft('person'), key: 'people', name: 'People', description: 'Finds people.', ...patch,
})

const group = (fields: string[], target: Record<string, string[]>) => ({
  relationType: 'works_for', direction: 'outgoing' as const, fields, target, label: null, template: null,
})

test('fields count own, relation and target fields together; the header does not count', () => {
  const d = draft({
    fields: ['name', 'age'],
    header: ['name'],
    relations: [group(['role'], { company: ['name', 'founded'] }), group([], { company: ['name'] })],
  })
  assert.equal(countFields(d), 6)
})

test('more than 12 fields or 4 groups are draft problems', () => {
  const many = Array.from({ length: MAX_INDEX_FIELDS }, (_, i) => `f${i}`)
  assert.deepEqual(draftProblems(draft({ fields: many })), [])
  const over = draftProblems(draft({ fields: many, relations: [group(['x'], {})] }))
  assert.ok(over.some((p) => p.path === 'fields' && p.message.includes('13')))
  const groups = Array.from({ length: 5 }, () => group(['x'], {}))
  assert.ok(draftProblems(draft({ relations: groups })).some((p) => p.path === 'relations'))
})

test('draft problems: required texts, something to read, a non-empty group, a representation', () => {
  const problems = draftProblems({ ...emptyDraft(), relations: [group([], { company: [] })], semantic: { enabled: false, template: null }, keyword: { enabled: false } })
  const paths = problems.map((p) => p.path)
  assert.deepEqual(paths, ['name', 'description', 'entityType', 'relations.0', 'semantic.enabled'])
  assert.ok(draftProblems(draft()).some((p) => p.path === 'fields'))
})

test('relation group options come from relation types touching the root in either direction', () => {
  const options = relationGroupOptions(schema, 'person').map((o) => `${o.relationType}/${o.direction}→${o.otherEnd}`)
  assert.deepEqual(options, ['works_for/outgoing→company', 'knows/outgoing→person', 'knows/incoming→person'])
  assert.deepEqual(relationGroupOptions(schema, 'company').map((o) => `${o.relationType}/${o.direction}`), ['works_for/incoming', 'owns/outgoing', 'owns/incoming'])
})

test('own field options are text and document properties; one document at most is tracked', () => {
  const root = schema.entityTypes[0]!
  assert.deepEqual(ownFieldOptions(root).map((p) => p.key), ['name', 'age', 'bio', 'cv'])
  assert.equal(selectedDocument(['name', 'bio'], root), 'bio')
  assert.equal(selectedDocument(['name'], root), null)
})

test('toggleKey appends and removes without reordering', () => {
  assert.deepEqual(toggleKey(['b', 'a'], 'c', true), ['b', 'a', 'c'])
  assert.deepEqual(toggleKey(['b', 'a'], 'a', true), ['b', 'a'])
  assert.deepEqual(toggleKey(['b', 'a'], 'b', false), ['a'])
})

test('toDefinition trims texts, nulls blank label and templates, drops empty target lists', () => {
  const d = toDefinition(draft({
    key: ' people ', name: ' People ', description: ' Finds people. ',
    relations: [{ ...group(['role'], { company: [] }), label: '  ', template: ' {role} ' }],
    semantic: { enabled: true, template: '' },
  }))
  assert.equal(d.key, 'people')
  assert.equal(d.name, 'People')
  assert.deepEqual(d.relations[0], { relationType: 'works_for', direction: 'outgoing', fields: ['role'], target: {}, label: null, template: '{role}' })
  assert.equal(d.semantic.template, null)
})

test('preview input leaves out a blank key; drafts equal by their definitions', () => {
  assert.equal('key' in toPreviewInput(draft({ key: '' })), false)
  assert.equal(toPreviewInput(draft()).key, 'people')
  assert.ok(sameDefinition(draft({ name: 'People ' }), draft()))
  assert.ok(!sameDefinition(draft({ fields: ['name'] }), draft()))
})

test('switching the root drops everything read from the old one', () => {
  const d = withEntityType(draft({ fields: ['name'], header: ['name'], relations: [group(['x'], {})] }), 'company')
  assert.deepEqual([d.entityType, d.fields, d.header, d.relations], ['company', [], null, []])
})

test('header mode: null = name property, [] = none, else chosen fields', () => {
  assert.equal(headerMode(null), 'name')
  assert.equal(headerMode([]), 'none')
  assert.equal(headerMode(['name']), 'fields')
})

test('issuesAt matches a path and everything below it, not siblings with a shared prefix', () => {
  const issues = [{ path: 'relations.0.fields.1', message: 'a' }, { path: 'relations.1', message: 'b' }, { path: 'relations.10', message: 'c' }, { path: 'fields', message: 'd' }]
  assert.deepEqual(issuesAt(issues, 'relations.1').map((i) => i.message), ['b'])
  assert.deepEqual(issuesAt(issues, 'relations.0').map((i) => i.message), ['a'])
  assert.deepEqual(issuesAt(issues, 'fields').map((i) => i.message), ['d'])
})

const rep = (representation: 'semantic' | 'keyword', state: IndexStatus['representations'][number]['state'], n: Partial<{ done: number; total: number; pending: number; failed: number }> = {}) =>
  ({ representation, state, done: 0, total: 0, pending: 0, failed: 0, ...n })

test('status chip text per state', () => {
  const status = (state: IndexStatus['state'], representations: IndexStatus['representations']): IndexStatus => ({ state, representations, lastErrors: [] })
  assert.deepEqual(statusChip(status('ready', [rep('keyword', 'ready')])), { label: 'ready', tone: 'ok' })
  assert.equal(statusChip(status('building', [rep('keyword', 'ready'), rep('semantic', 'building', { done: 3, total: 10 })])).label, 'building 3/10')
  assert.equal(statusChip(status('building', [])).label, 'building')
  assert.equal(statusChip(status('stale', [rep('keyword', 'stale', { pending: 2 }), rep('semantic', 'stale', { pending: 5 })])).label, 'stale · 7 pending')
  assert.equal(statusChip(status('failed', [rep('semantic', 'failed', { failed: 4 })])).label, 'failed · 4')
  assert.equal(statusChip(status('disabled', [])).label, 'disabled')
  assert.equal(statusChip(status('unavailable', [rep('semantic', 'unavailable')])).tone, 'muted')
})

test('durations read roughly', () => {
  assert.equal(formatDuration(0.2), '< 1 s')
  assert.equal(formatDuration(42.4), '42 s')
  assert.equal(formatDuration(600), '10 min')
  assert.equal(formatDuration(9000), '2.5 h')
  assert.equal(formatDuration(72000), '20 h')
})

test('keyword languages: at least one stays on, canonical order', () => {
  assert.deepEqual(toggleKeywordLanguage(['english'], 'german', true), ['german', 'english'])
  assert.deepEqual(toggleKeywordLanguage(['german', 'english'], 'german', false), ['english'])
  assert.deepEqual(toggleKeywordLanguage(['german'], 'german', false), ['german'])
})

test('switching a managed index edits the sorted disabled list', () => {
  assert.deepEqual(toggleDisabledIndex(['z~default'], 'a~bio', false), ['a~bio', 'z~default'])
  assert.deepEqual(toggleDisabledIndex(['a~bio', 'z~default'], 'a~bio', true), ['z~default'])
})

test('managed indices group by entity type; custom ones are left out', () => {
  const record = (key: string, kind: SearchIndexRecord['kind'], entityType: string) =>
    ({ key, kind, definition: { ...emptyDraft(entityType), key } }) as SearchIndexRecord
  const groups = managedByEntityType([
    record('company~default', 'default', 'company'),
    record('people', 'custom', 'person'),
    record('person~bio', 'passage', 'person'),
    record('person~default', 'default', 'person'),
  ])
  assert.deepEqual(groups.map((g) => [g.entityType, g.defaultIndex?.key ?? null, g.passages.map((p) => p.key)]), [
    ['company', 'company~default', []],
    ['person', 'person~default', ['person~bio']],
  ])
})
