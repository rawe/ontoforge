import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { StagedEntity, StagedObjectView, StagedValueView } from '../src/api/types.ts'
import { stagedFields } from '../src/components/entity/stagedFields.ts'

const value = (property: string, extra: Partial<StagedValueView> = {}): StagedValueView => ({
  property,
  before: null,
  current: null,
  after: null,
  markers: [],
  ...extra,
})

const object = (action: StagedObjectView['action'], values: StagedValueView[]): StagedObjectView => ({
  id: 'T1',
  kind: 'entity',
  type: 'task',
  action,
  firstTouchedAt: '2026-10-21T10:00:00Z',
  name: 'T1',
  markers: [],
  values,
})

const entity = (values: Record<string, StagedEntity['entity'][string]>): StagedEntity['entity'] => ({
  _id: 'T1',
  _entityTypeKey: 'task',
  ...values,
})

test('stagedFields: nothing staged on the entity sets nothing', () => {
  assert.deepEqual(stagedFields({ entity: entity({ name: 'T1' }), deleted: false, object: null }), {})
})

test('stagedFields: the staged values, with the value a commit would leave', () => {
  const fields = stagedFields({
    entity: entity({ name: 'T1 b', notes: { document: true, length: 17 }, status: 'open' }),
    deleted: false,
    object: object('update', [
      value('name', { before: 'T1', current: 'T1', after: 'T1 b' }),
      value('notes', { after: { document: true, length: 17 } }),
      value('cost', { before: 3, current: 3, after: null }),
    ]),
  })
  assert.deepEqual(fields, {
    name: { value: 'T1 b', drift: null },
    notes: { value: { document: true, length: 17 }, drift: null },
    // Removed by a staged null: not in the entity a commit would leave.
    cost: { value: null, drift: null },
  })
})

test('stagedFields: a staged create sets its values; a delete sets none', () => {
  const create = stagedFields({ entity: entity({ name: 'T9' }), deleted: false, object: object('create', [value('name', { after: 'T9' })]) })
  assert.deepEqual(create, { name: { value: 'T9', drift: null } })
  assert.deepEqual(stagedFields({ entity: entity({ name: 'T1' }), deleted: true, object: object('delete', []) }), {})
})

test('stagedFields: drift sits on the values it was found on', () => {
  const drift = { kind: 'drift', message: 'Changed since it was staged' }
  const fields = stagedFields({
    entity: entity({ name: 'T1 b', status: 'done' }),
    deleted: false,
    object: object('update', [
      value('name', { before: 'T1', current: 'T1 live', after: 'T1 b', markers: [drift] }),
      value('status', { before: 'open', current: 'open', after: 'done', markers: [{ kind: 'replay', message: 'x' }] }),
    ]),
  })
  assert.deepEqual(fields.name, { value: 'T1 b', drift })
  assert.deepEqual(fields.status, { value: 'done', drift: null })
})
