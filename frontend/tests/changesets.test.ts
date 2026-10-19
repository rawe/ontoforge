import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ChangesetListItem, ChangesetViolation, StagedWriteView } from '../src/api/types.ts'
import {
  changeText,
  isCommittedDataKey,
  isVersionMismatch,
  markerLabel,
  MAX_NOTE_LENGTH,
  operationLabel,
  operationsSummary,
  shortId,
  sortChangesets,
  stateLabel,
  submittedCount,
  targetText,
  typesText,
  valueText,
  violationLine,
  violationsNote,
  violationsOf,
  writesText,
} from '../src/components/changesets/changesets.ts'
import { stagedOnlyOffConfirmation } from '../src/components/anchors/anchors.ts'
import { qk } from '../src/api/queryKeys.ts'

const item = (id: string, state: ChangesetListItem['state'], lastChangeAt: string): ChangesetListItem => ({
  id,
  state,
  version: 2,
  note: null,
  anchor: null,
  writeCount: 1,
  createdAt: '2026-10-19T10:00:00.000Z',
  lastChangeAt,
  submittedAt: state === 'submitted' ? lastChangeAt : null,
  operations: { update_entity: 1 },
  types: ['project'],
  notVisible: 0,
})

const write = (over: Partial<StagedWriteView>): StagedWriteView => ({
  seq: 1,
  operation: 'update_entity',
  type: 'project',
  id: 'p-2000000-0000',
  arguments: {},
  createdAt: '2026-10-19T10:00:00.000Z',
  before: null,
  current: null,
  after: null,
  markers: [],
  ...over,
})

test('stateLabel names both states', () => {
  assert.equal(stateLabel('draft'), 'draft')
  assert.equal(stateLabel('submitted'), 'submitted')
})

test('sortChangesets puts submitted first, then the latest change', () => {
  const draft = item('draft-new', 'draft', '2026-10-19T12:00:00.000Z')
  const oldDraft = item('draft-old', 'draft', '2026-10-19T09:00:00.000Z')
  const sub = item('sub-old', 'submitted', '2026-10-18T09:00:00.000Z')
  const sub2 = item('sub-new', 'submitted', '2026-10-19T11:00:00.000Z')
  const sorted = sortChangesets([oldDraft, draft, sub, sub2]).map((c) => c.id)
  assert.deepEqual(sorted, ['sub-new', 'sub-old', 'draft-new', 'draft-old'])
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

test('operation texts: the label, the summary by verb, the write count', () => {
  assert.equal(operationLabel('create_entity'), 'create entity')
  assert.equal(operationLabel('delete_relation'), 'delete relation')
  assert.equal(
    operationsSummary({ create_entity: 1, create_relation: 1, delete_relation: 1, delete_entity: 1, update_entity: 1 }),
    'create 2 · update 1 · delete 2',
  )
  assert.equal(operationsSummary({}), '')
  assert.equal(writesText(1), '1 write')
  assert.equal(writesText(1240), '1,240 writes')
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
  assert.equal(targetText(write({ name: 'P2' })), 'P2')
  assert.equal(targetText(write({ operation: 'create_entity', name: 'P4' })), 'P4 (new)')
  assert.equal(targetText(write({ name: null, id: '7f3a9c00-0000' })), '7f3a9c00…')
  assert.equal(
    targetText(
      write({
        operation: 'delete_relation',
        type: 'has_task',
        from: { id: 'p1', name: 'P1' },
        to: { id: 't3', name: null },
      }),
    ),
    'P1 → t3',
  )
  assert.equal(
    targetText(write({ operation: 'update_relation', type: 'has_task', id: 'r-12345678-x', from: null, to: null })),
    'r-123456…',
  )
  assert.equal(targetText(write({ type: null, id: null })), '—')
  assert.equal(shortId('abc'), 'abc')
})

test('changeText: before → after for updates, set values for creates, — for deletes', () => {
  assert.equal(
    changeText(write({ before: { name: 'P2' }, current: { name: 'P2' }, after: { name: 'P2 Website' } })),
    'name: "P2" → "P2 Website"',
  )
  // A target this changeset creates has no before.
  assert.equal(changeText(write({ before: null, after: { name: 'T9 b' } })), 'name: "T9 b"')
  // A target gone since staging keeps its before.
  assert.equal(changeText(write({ before: { name: 'P2' }, after: { name: 'x' } })), 'name: "P2" → "x"')
  assert.equal(
    changeText(write({ before: { body: { sha256: 'ab' } }, current: { body: { document: true, length: 3 } }, after: { body: { document: true, length: 5 } } })),
    'body: document → document (5 characters)',
  )
  assert.equal(
    changeText(
      write({
        operation: 'create_entity',
        after: { name: 'T9' },
        parent: { id: 'p1', name: 'P1' },
        arguments: { properties: { name: 'T9' }, parentRelation: { type: 'has_task', parentId: 'p1', properties: { phase: 'build' } } },
      }),
    ),
    'name: "T9" · under P1 (phase: "build")',
  )
  assert.equal(
    changeText(
      write({
        operation: 'create_entity',
        after: { name: 'P4' },
        parent: { id: 'acme', name: 'ACME' },
        arguments: { parentRelation: { type: 'has_project', parentId: 'acme' } },
      }),
    ),
    'name: "P4" · under ACME',
  )
  assert.equal(changeText(write({ operation: 'create_relation', type: 'has_task', after: {} })), '—')
  assert.equal(changeText(write({ operation: 'delete_entity' })), '—')
  assert.equal(changeText(write({ type: null })), 'Not visible through this lens')
})

test('changeText: a drifted update also shows the current value of each key that changed', () => {
  const drift = [{ kind: 'drift', message: "Entity 'p2' changed since this write was staged; unstage and restage it" }]
  assert.equal(
    changeText(
      write({
        before: { name: 'P3 Renamed', code: 'X' },
        current: { name: 'P3 Renamed from human', code: 'X' },
        after: { name: 'P3 Second', code: 'Y' },
        markers: drift,
      }),
    ),
    'name: "P3 Renamed" → "P3 Second" (now "P3 Renamed from human"); code: "X" → "Y"',
  )
  // A document's before is a hash: on drift its current value is shown.
  assert.equal(
    changeText(
      write({
        before: { body: { sha256: 'ab' } },
        current: { body: { document: true, length: 9 } },
        after: { body: { document: true, length: 5 } },
        markers: drift,
      }),
    ),
    'body: document → document (5 characters) (now document (9 characters))',
  )
  // Without a drift marker the current value is not shown.
  assert.equal(
    changeText(write({ before: { name: 'A' }, current: { name: 'B' }, after: { name: 'C' } })),
    'name: "A" → "C"',
  )
})

test('markerLabel names the markers', () => {
  assert.equal(markerLabel('drift'), 'drift')
  assert.equal(markerLabel('dangling'), 'dangling')
  assert.equal(markerLabel('not_visible'), 'not visible')
  assert.equal(markerLabel('missing'), 'missing')
  assert.equal(markerLabel('replay'), 'invalid value')
})

const v = (seq: number, kind: string, message: string): ChangesetViolation => ({ seq, kind, message })

test('violationsOf reads a rejection, and nothing else', () => {
  const violations = [v(3, 'has_children', "Entity 'p3' has children")]
  assert.deepEqual(violationsOf({ violations, total: 1 }), { violations, total: 1 })
  assert.deepEqual(violationsOf({ violations }), { violations, total: 1 })
  assert.equal(violationsOf({ fields: { note: 'x' } }), null)
  assert.equal(violationsOf({ violations: [] }), null)
  assert.equal(violationsOf(undefined), null)
})

test('violationLine numbers a write; seq 0 is the whole changeset', () => {
  assert.equal(violationLine(v(15, 'has_children', 'P2 has children')), '#15 has_children: P2 has children')
  assert.equal(violationLine(v(0, 'anchor_gone', 'Anchor gone')), 'anchor_gone: Anchor gone')
})

test('violationsNote (R12): header, one line each, the rest counted, cut to 1,000', () => {
  assert.equal(
    violationsNote([v(1, 'has_children', "Entity 'p3' has children")], 1),
    "Commit rejected: 1 violation\n#1 has_children: Entity 'p3' has children",
  )
  assert.equal(
    violationsNote([v(1, 'drift', 'a'), v(2, 'dangling', 'b')], 140),
    'Commit rejected: 140 violations\n#1 drift: a\n#2 dangling: b\n… and 138 more',
  )
  const long = Array.from({ length: 100 }, (_, i) => v(i + 1, 'has_children', `Entity ${'x'.repeat(30)} has children`))
  const note = violationsNote(long, 100)
  assert.equal(note.length, MAX_NOTE_LENGTH)
  assert.ok(note.endsWith('…'))
  assert.ok(note.startsWith('Commit rejected: 100 violations\n#1 '))
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
  assert.equal(isCommittedDataKey(['anchors', 'o1'], 'o1'), true)
  assert.equal(isCommittedDataKey(['palette', 'entitySearch', 'o1', 'all'], 'o1'), true)
  assert.equal(isCommittedDataKey(['entities', 'o2', 'all', 'task'], 'o1'), false)
  assert.equal(isCommittedDataKey(['schema', 'o1', 'all'], 'o1'), false)
  assert.equal(isCommittedDataKey(['changesets', 'o1', 'all'], 'o1'), false)
})

test('stagedOnlyOffConfirmation names the escape', () => {
  assert.equal(
    stagedOnlyOffConfirmation('agent-a'),
    'agent-a will write immediately again: its writes no longer need a changeset, and it can commit.',
  )
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
