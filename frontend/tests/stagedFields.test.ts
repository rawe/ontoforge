import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { StagedEntity, StagedWriteView } from '../src/api/types.ts'
import { deletedInChangeset, stagedFields } from '../src/components/entity/stagedFields.ts'

const write = (seq: number, operation: StagedWriteView['operation'], extra: Partial<StagedWriteView> = {}): StagedWriteView => ({
  seq,
  operation,
  type: 'task',
  id: 'T1',
  createdAt: '2026-10-21T10:00:00Z',
  before: null,
  current: null,
  after: null,
  markers: [],
  ...extra,
})

const entity = (values: Record<string, StagedEntity['entity'][string]>): StagedEntity['entity'] => ({
  _id: 'T1',
  _entityTypeKey: 'task',
  ...values,
})

test('stagedFields: nothing staged on the entity sets nothing', () => {
  assert.deepEqual(stagedFields({ entity: entity({ name: 'T1' }), deleted: false, writes: [] }), {})
})

test('stagedFields: the keys of creates and updates, with the folded value', () => {
  const fields = stagedFields({
    entity: entity({ name: 'T1 b', notes: { document: true, length: 17 }, status: 'open' }),
    deleted: false,
    writes: [
      write(1, 'update_entity', { before: { name: 'T1' }, current: { name: 'T1' }, after: { name: 'T1 a' } }),
      write(2, 'update_entity', {
        before: { name: 'T1', cost: 3 },
        current: { name: 'T1', cost: 3 },
        after: { name: 'T1 b', notes: { document: true, length: 17 }, cost: null },
      }),
    ],
  })
  assert.deepEqual(fields, {
    name: { value: 'T1 b', drift: null },
    notes: { value: { document: true, length: 17 }, drift: null },
    // Removed by a staged null: not in the folded entity.
    cost: { value: null, drift: null },
  })
})

test('stagedFields: a staged create sets its values; a delete sets none', () => {
  const fields = stagedFields({
    entity: entity({ name: 'T9' }),
    deleted: true,
    writes: [write(1, 'create_entity', { after: { name: 'T9' } }), write(2, 'delete_entity')],
  })
  assert.deepEqual(fields, { name: { value: 'T9', drift: null } })
})

test('stagedFields: drift marks the keys whose stored value changed, and stays on later writes', () => {
  const drift = { kind: 'drift', message: 'Changed since this write was staged' }
  const fields = stagedFields({
    entity: entity({ name: 'T1 b', status: 'done' }),
    deleted: false,
    writes: [
      write(1, 'update_entity', {
        before: { name: 'T1', status: 'open' },
        current: { name: 'T1 live', status: 'open' },
        after: { name: 'T1 a', status: 'done' },
        markers: [drift],
      }),
      write(2, 'update_entity', { before: { name: 'T1 live' }, current: { name: 'T1 live' }, after: { name: 'T1 b' } }),
    ],
  })
  assert.deepEqual(fields.name, { value: 'T1 b', drift })
  assert.deepEqual(fields.status, { value: 'done', drift: null })
})

test('stagedFields: a drift with no visible change marks every key the write sets', () => {
  const drift = { kind: 'drift', message: 'Changed since this write was staged' }
  const fields = stagedFields({
    entity: entity({ name: 'T1 a' }),
    deleted: false,
    writes: [
      write(1, 'update_entity', {
        before: { name: 'T1' },
        current: { name: 'T1' },
        after: { name: 'T1 a' },
        markers: [drift, { kind: 'not_visible', message: 'Hidden' }],
      }),
    ],
  })
  assert.deepEqual(fields.name.drift, drift)
})

test('deletedInChangeset: any staged delete, also with a later write', () => {
  const none: StagedEntity = { entity: entity({}), deleted: false, writes: [write(1, 'update_entity', { after: { name: 'x' } })] }
  assert.equal(deletedInChangeset(none), false)
  const later: StagedEntity = {
    entity: entity({ name: 'x' }),
    deleted: false,
    writes: [write(1, 'delete_entity'), write(2, 'update_entity', { after: { name: 'x' } })],
  }
  assert.equal(deletedInChangeset(later), true)
  assert.equal(deletedInChangeset({ entity: entity({}), deleted: true, writes: [write(1, 'delete_entity')] }), true)
})
