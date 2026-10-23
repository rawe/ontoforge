import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ChangesetListItem, ChangesetViolation, StagedObjectView, StagedValueView } from '../src/api/types.ts'
import {
  changesetLabel,
  hasDrift,
  isCommittedDataKey,
  isVersionMismatch,
  lensDeletedText,
  markerLabel,
  MAX_NOTE_LENGTH,
  objectOperation,
  objectsText,
  operationLabel,
  operationsSummary,
  shortId,
  stagedCreateValues,
  stagedDocumentKeys,
  stateLabel,
  submittedCount,
  targetText,
  typesText,
  valueChangeText,
  valueText,
  violationLabel,
  violationLine,
  violationPrefix,
  violationsNote,
  violationsOf,
} from '../src/components/changesets/changesets.ts'
import { qk } from '../src/api/queryKeys.ts'

const item = (id: string, state: ChangesetListItem['state'], lastChangeAt: string): ChangesetListItem => ({
  id,
  number: 1,
  state,
  version: 2,
  note: null,
  ruleset: null,
  objectCount: 1,
  createdAt: '2026-10-19T10:00:00.000Z',
  lastChangeAt,
  submittedAt: state === 'submitted' ? lastChangeAt : null,
  operations: { update_entity: 1 },
  types: ['project'],
  notVisible: 0,
})

const object = (over: Partial<StagedObjectView>): StagedObjectView => ({
  id: 'p-2000000-0000',
  kind: 'entity',
  type: 'project',
  action: 'update',
  firstTouchedAt: '2026-10-19T10:00:00.000Z',
  markers: [],
  values: [],
  ...over,
})

const value = (over: Partial<StagedValueView>): StagedValueView => ({
  property: 'name',
  before: null,
  current: null,
  after: null,
  markers: [],
  ...over,
})

const drift = [{ kind: 'drift', message: 'Changed since it was staged' }]
const doc = (length: number | null) => ({ document: true, length })

test('stateLabel names both states', () => {
  assert.equal(stateLabel('draft'), 'draft')
  assert.equal(stateLabel('submitted'), 'submitted')
})

test('submittedCount counts only submitted changesets: the sidebar count', () => {
  assert.equal(submittedCount([]), 0)
  assert.equal(
    submittedCount([
      item('a', 'submitted', '2026-10-19T10:00:00.000Z'),
      item('b', 'draft', '2026-10-19T10:00:00.000Z'),
      item('c', 'submitted', '2026-10-19T10:00:00.000Z'),
    ]),
    2,
  )
})

test('operation texts: the label, the summary by verb, the object count', () => {
  assert.equal(operationLabel('create_entity'), 'create entity')
  assert.equal(operationLabel('delete_relation'), 'delete relation')
  assert.equal(
    operationsSummary({ create_entity: 1, create_relation: 1, delete_relation: 1, delete_entity: 1, update_entity: 1 }),
    'create 2 · update 1 · delete 2',
  )
  assert.equal(operationsSummary({}), '')
  assert.equal(objectOperation({ action: 'update', kind: 'relation' }), 'update_relation')
  assert.equal(objectsText(1), '1 staged object')
  assert.equal(objectsText(1240), '1,240 staged objects')
})

test('lensDeletedText names the deleted changesets only when there are any', () => {
  assert.equal(lensDeletedText(0), 'Lens deleted')
  assert.equal(lensDeletedText(1), 'Lens deleted with 1 changeset')
  assert.equal(lensDeletedText(3), 'Lens deleted with 3 changesets')
})

test('typesText names two types, counts the rest, and the hidden ones', () => {
  const name = (key: string) => ({ project: 'Project', task: 'Task' })[key] ?? key
  assert.equal(typesText(['project', 'task'], 0, name), 'Project, Task')
  assert.equal(typesText(['has_task', 'project', 'task'], 0, name), 'has_task, Project, +1')
  assert.equal(typesText(['task'], 1, name), 'Task, 1 not visible')
  assert.equal(typesText([], 0, name), '—')
})

test('valueText quotes strings, stubs documents, prints the rest', () => {
  assert.equal(valueText('P2'), '"P2"')
  assert.equal(valueText(null), 'empty')
  assert.equal(valueText(undefined), 'empty')
  assert.equal(valueText(3), '3')
  assert.equal(valueText(true), 'true')
  assert.equal(valueText({ document: true, length: 120 }), 'document (120 characters)')
  assert.equal(valueText(['a']), '["a"]')
})

test('targetText: entity names, new creates, relation ends, ids when unnamed', () => {
  assert.equal(targetText(object({ name: 'P2' })), 'P2')
  assert.equal(targetText(object({ action: 'create', name: 'P4' })), 'P4 (new)')
  assert.equal(targetText(object({ name: null, id: '7f3a9c00-0000' })), '7f3a9c00…')
  assert.equal(
    targetText(
      object({
        kind: 'relation',
        action: 'delete',
        type: 'has_task',
        from: { id: 'p1', name: 'P1' },
        to: { id: 't3', name: null },
      }),
    ),
    'P1 → t3',
  )
  assert.equal(targetText(object({ type: null })), '—')
  assert.equal(shortId('abc'), 'abc')
})

test('valueChangeText: before → after on an update, the staged value on a create', () => {
  const update = object({})
  assert.equal(valueChangeText(update, value({ before: 'P2', current: 'P2', after: 'P2 Website' })), '"P2" → "P2 Website"')
  // A key the target lacked, and a staged null that removes the property.
  assert.equal(valueChangeText(update, value({ before: null, after: 3 })), 'empty → 3')
  assert.equal(valueChangeText(update, value({ before: 'x', after: null })), '"x" → empty')
  assert.equal(
    valueChangeText(update, value({ before: doc(3), current: doc(3), after: doc(5) })),
    'document (3 characters) → document (5 characters)',
  )
  // A before recorded without a length.
  assert.equal(valueChangeText(update, value({ before: doc(null), after: doc(5) })), 'document → document (5 characters)')
  assert.equal(valueChangeText(object({ action: 'create' }), value({ after: 'T9' })), '"T9"')
})

test('valueChangeText: a drifted value also shows its current stored value', () => {
  const update = object({})
  assert.equal(
    valueChangeText(update, value({ before: 'P3', current: 'P3 live', after: 'P3 b', markers: drift })),
    '"P3" → "P3 b" (now "P3 live")',
  )
  assert.equal(
    valueChangeText(update, value({ before: doc(3), current: doc(9), after: doc(5), markers: drift })),
    'document (3 characters) → document (5 characters) (now document (9 characters))',
  )
  // Without a drift marker the current value is not shown.
  assert.equal(valueChangeText(update, value({ before: 'A', current: 'B', after: 'C' })), '"A" → "C"')
  assert.equal(hasDrift(value({ markers: drift })), true)
  assert.equal(hasDrift(value({ markers: [{ kind: 'replay', message: 'x' }] })), false)
})

test('stagedDocumentKeys: the document values an entity create or update sets', () => {
  const values = [value({ property: 'name', after: 'T1' }), value({ property: 'notes', after: doc(12) }), value({ property: 'summary', after: doc(3) })]
  assert.deepEqual(stagedDocumentKeys(object({ values })), ['notes', 'summary'])
  assert.deepEqual(stagedDocumentKeys(object({ action: 'create', values })), ['notes', 'summary'])
  // A staged null removes the text: nothing to read.
  assert.deepEqual(stagedDocumentKeys(object({ values: [value({ property: 'notes', after: null })] })), [])
  assert.deepEqual(stagedDocumentKeys(object({ action: 'delete' })), [])
  assert.deepEqual(stagedDocumentKeys(object({ kind: 'relation', values })), [])
  assert.deepEqual(stagedDocumentKeys(object({ type: null })), [])
})

test('markerLabel names the markers', () => {
  assert.equal(markerLabel('drift'), 'drift')
  assert.equal(markerLabel('dangling'), 'dangling')
  assert.equal(markerLabel('not_visible'), 'not visible')
  assert.equal(markerLabel('missing'), 'missing')
  assert.equal(markerLabel('replay'), 'invalid value')
})

const v = (id: string | null, kind: string, message: string, property?: string): ChangesetViolation =>
  property === undefined ? { object: id, kind, message } : { object: id, property, kind, message }

test('violationsOf reads a rejection, and nothing else', () => {
  const violations = [v('p3', 'has_children', 'Still has children')]
  assert.deepEqual(violationsOf({ violations, total: 1 }), { violations, total: 1 })
  assert.deepEqual(violationsOf({ violations }), { violations, total: 1 })
  assert.equal(violationsOf({ fields: { note: 'x' } }), null)
  assert.equal(violationsOf({ violations: [] }), null)
  assert.equal(violationsOf(undefined), null)
})

test('violationLine names the staged object and the property; a changeset-wide one starts with nothing', () => {
  const objects = [
    object({ id: 'p2', name: 'P2 Live' }),
    object({ id: 'r1', kind: 'relation', action: 'create', type: 'has_task', from: { id: 'p1', name: 'P1' }, to: { id: 't3', name: 'T3' } }),
    object({ id: 'x', type: null }),
  ]
  assert.equal(
    violationLine(v('p2', 'drift', 'Changed since it was staged', 'name'), objects),
    'P2 Live · name: drift — Changed since it was staged',
  )
  assert.equal(
    violationLine(v('r1', 'two_parents', 'The target end already has a parent'), objects),
    'P1 → T3: two_parents — The target end already has a parent',
  )
  // Not visible, or not on the page shown: unnamed.
  assert.equal(violationLine(v('x', 'not_visible', 'x'), objects), 'not_visible — x')
  assert.equal(violationLine(v('elsewhere', 'replay', 'bad', 'budget')), 'budget: replay — bad')
  assert.equal(
    violationLine(v(null, 'ruleset_gone', "Ruleset 'agent-a' no longer exists")),
    "ruleset_gone — Ruleset 'agent-a' no longer exists",
  )
  assert.equal(violationPrefix(v('p2', 'missing', 'x'), objects), 'P2 Live: ')
  assert.equal(violationPrefix(v(null, 'ruleset_gone', 'x'), objects), '')
})

test('violationLabel names the five ruleset kinds for people, and only them', () => {
  assert.deepEqual(
    ['ruleset_gone', 'outside_subtree', 'anchor_deleted', 'anchor_hidden', 'deletes_anchor'].map(violationLabel),
    [
      'Ruleset deleted',
      "Outside the anchor's subtree",
      'Anchor deleted',
      'Anchor hidden by the lens',
      "Deletes a ruleset's anchor",
    ],
  )
  for (const kind of ['drift', 'dangling', 'has_children', 'two_parents', 'not_visible', 'replay']) {
    assert.equal(violationLabel(kind), null, kind)
  }
})

test('violationsNote (R12): header, one line each, the rest counted, cut to 1,000', () => {
  assert.equal(
    violationsNote([v('p3', 'has_children', 'Still has children')], 1, [object({ id: 'p3', action: 'delete', name: 'P3' })]),
    'Commit rejected: 1 violation\nP3: has_children — Still has children',
  )
  assert.equal(
    violationsNote([v('a', 'drift', 'a', 'name'), v('b', 'dangling', 'b')], 140),
    'Commit rejected: 140 violations\nname: drift — a\ndangling — b\n… and 138 more',
  )
  // The note keeps the raw kinds: an agent reads it.
  assert.equal(
    violationsNote([v('c', 'outside_subtree', "Outside the anchor subtree of ruleset 'agent-a'"), v(null, 'ruleset_gone', 'gone')], 2),
    "Commit rejected: 2 violations\noutside_subtree — Outside the anchor subtree of ruleset 'agent-a'\nruleset_gone — gone",
  )
  const long = Array.from({ length: 100 }, (_, i) => v(`e${i}`, 'has_children', `Entity ${'x'.repeat(30)} has children`))
  const note = violationsNote(long, 100)
  assert.equal(note.length, MAX_NOTE_LENGTH)
  assert.ok(note.endsWith('…'))
  assert.ok(note.startsWith('Commit rejected: 100 violations\nhas_children — '))
})

test('isVersionMismatch tells the stale version from other 409s', () => {
  assert.equal(
    isVersionMismatch({ status: 409, message: "Changeset 'x' changed since you looked: version 3, not 2" }),
    true,
  )
  assert.equal(isVersionMismatch({ status: 409, message: 'Another commit is running; try again' }), false)
  assert.equal(isVersionMismatch({ status: 422, message: 'changed since you looked' }), false)
})

test('isCommittedDataKey: runtime data of this ontology, not schema or other ontologies', () => {
  assert.equal(isCommittedDataKey(['entities', 'o1', 'all', 'task'], 'o1'), true)
  assert.equal(isCommittedDataKey(['entity', 'o1', 'all', 'task', '1'], 'o1'), true)
  assert.equal(isCommittedDataKey(['neighborCounts', 'o1', 'all', 'task', '1'], 'o1'), true)
  assert.equal(isCommittedDataKey(['rulesets', 'o1'], 'o1'), true)
  assert.equal(isCommittedDataKey(['palette', 'entitySearch', 'o1', 'all'], 'o1'), true)
  assert.equal(isCommittedDataKey(['entities', 'o2', 'all', 'task'], 'o1'), false)
  assert.equal(isCommittedDataKey(['schema', 'o1', 'all'], 'o1'), false)
  assert.equal(isCommittedDataKey(['changesets', 'o1', 'all'], 'o1'), false)
})

test('a read key sits under its list key, which an exact invalidation leaves alone', () => {
  // The detail refreshes the list with `exact: true` after a commit or discard,
  // so the gone changeset's read (under the list key) is not refetched into a 404.
  const list = qk.changesets('o1', 'all')
  const read = qk.changesets('o1', 'all', 'cs-1', { offset: 0, limit: 100 })
  assert.deepEqual(read.slice(0, list.length), [...list])
  assert.notDeepEqual([...read], [...list])
  assert.deepEqual(qk.changesets('o1', 'all', 'cs-1'), ['changesets', 'o1', 'all', 'cs-1'])
})

test('changesetLabel names a changeset by its number and note, else its note or short id', () => {
  assert.equal(changesetLabel({ id: '7f3a9c00-1111-2222', number: 12, note: 'Move the tasks' }), '#12 · Move the tasks')
  assert.equal(changesetLabel({ id: '7f3a9c00-1111-2222', number: 12, note: null }), '#12')
  assert.equal(changesetLabel({ id: '7f3a9c00-1111-2222', note: 'Move the tasks' }), 'Move the tasks')
  assert.equal(changesetLabel({ id: '7f3a9c00-1111-2222', note: null }), '7f3a9c00…')
})

test('stagedCreateValues: the values of an entity this changeset creates', () => {
  const values = [value({ property: 'name', after: 'P9' }), value({ property: 'budget', after: 5 })]
  assert.deepEqual(stagedCreateValues(object({ action: 'create', values })), { name: 'P9', budget: 5 })
  // Only entity creates of a visible type.
  assert.equal(stagedCreateValues(object({ values })), null)
  assert.equal(stagedCreateValues(object({ action: 'create', kind: 'relation', values })), null)
  assert.equal(stagedCreateValues(object({ action: 'create', type: null })), null)
})
