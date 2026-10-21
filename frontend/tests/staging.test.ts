import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSerialQueue,
  documentWrite,
  isChangesetGone,
  LEFT_CHANGESET_TEXT,
  stagedOutcome,
  stageIntoPinned,
  stagePayload,
} from '../src/api/staging.ts'

test('stagePayload nests a create\'s values and carries its parent relation', () => {
  assert.deepEqual(stagePayload({ operation: 'create_entity', type: 'task', properties: { name: 'T1' } }), {
    operation: 'create_entity',
    type: 'task',
    properties: { name: 'T1' },
  })
  const parentRelation = { type: 'has_task', parentId: 'p-1', properties: { rank: 2 } }
  assert.deepEqual(
    stagePayload({ operation: 'create_entity', type: 'task', properties: {}, parentRelation }),
    { operation: 'create_entity', type: 'task', properties: {}, parentRelation },
  )
})

test('stagePayload keeps an update\'s nulls: they remove the property', () => {
  assert.deepEqual(
    stagePayload({ operation: 'update_entity', type: 'task', id: 't-1', properties: { name: 'T2', notes: null } }),
    { operation: 'update_entity', type: 'task', id: 't-1', properties: { name: 'T2', notes: null } },
  )
})

test('stagePayload splits a relation body into its ends and its values', () => {
  assert.deepEqual(
    stagePayload({
      operation: 'create_relation',
      type: 'assigned_to',
      body: { fromEntityId: 'a', toEntityId: 'b', role: 'lead' },
    }),
    { operation: 'create_relation', type: 'assigned_to', fromEntityId: 'a', toEntityId: 'b', properties: { role: 'lead' } },
  )
  assert.deepEqual(
    stagePayload({ operation: 'create_relation', type: 'assigned_to', body: { fromEntityId: 'a', toEntityId: 'b' } }),
    { operation: 'create_relation', type: 'assigned_to', fromEntityId: 'a', toEntityId: 'b', properties: {} },
  )
})

test('stagePayload names only type and id for deletes', () => {
  assert.deepEqual(stagePayload({ operation: 'delete_entity', type: 'task', id: 't-1' }), {
    operation: 'delete_entity',
    type: 'task',
    id: 't-1',
  })
  assert.deepEqual(stagePayload({ operation: 'delete_relation', type: 'assigned_to', id: 'r-1' }), {
    operation: 'delete_relation',
    type: 'assigned_to',
    id: 'r-1',
  })
})

test('stagedOutcome names the changeset beside the answer', () => {
  assert.deepEqual(stagedOutcome('cs-1', { seq: 7, id: 'e-1', relation: { seq: 8, id: 'r-1' } }), {
    kind: 'staged',
    changesetId: 'cs-1',
    seq: 7,
    id: 'e-1',
    relation: { seq: 8, id: 'r-1' },
  })
})

test('documentWrite sets the whole value as an update, null clears it', () => {
  assert.deepEqual(stagePayload(documentWrite('task', 't-1', 'body', '# Text')), {
    operation: 'update_entity',
    type: 'task',
    id: 't-1',
    properties: { body: '# Text' },
  })
  assert.deepEqual(documentWrite('task', 't-1', 'body', null), {
    operation: 'update_entity',
    type: 'task',
    id: 't-1',
    properties: { body: null },
  })
})

test('isChangesetGone tells the changeset\'s 404 from a missing target or type', () => {
  assert.equal(isChangesetGone({ status: 404, message: "Changeset 'cs-1' not found" }, 'cs-1'), true)
  assert.equal(isChangesetGone({ status: 404, message: "Entity 't-1' not found" }, 'cs-1'), false)
  assert.equal(isChangesetGone({ status: 409, message: "Changeset 'cs-1' is busy; try again" }, 'cs-1'), false)
})

const deferred = () => {
  let resolve!: () => void
  let reject!: (err: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('createSerialQueue runs one task at a time per key, even after a failure', async () => {
  const enqueue = createSerialQueue()
  const log: string[] = []
  const first = deferred()
  const a = enqueue('cs-1', async () => {
    log.push('a start')
    await first.promise
    log.push('a end')
  })
  const b = enqueue('cs-1', async () => {
    log.push('b')
    return 'b done'
  })
  await Promise.resolve()
  assert.deepEqual(log, ['a start'])
  first.reject(new Error('busy'))
  await assert.rejects(a, /busy/)
  assert.equal(await b, 'b done')
  assert.deepEqual(log, ['a start', 'b'])
})

test('createSerialQueue runs tasks of different keys side by side', async () => {
  const enqueue = createSerialQueue()
  const log: string[] = []
  const first = deferred()
  const a = enqueue('cs-1', async () => {
    await first.promise
    log.push('a')
  })
  const b = enqueue('cs-2', async () => {
    log.push('b')
  })
  await b
  assert.deepEqual(log, ['b'])
  first.resolve()
  await a
  assert.deepEqual(log, ['b', 'a'])
})

test('stageIntoPinned reads the pin when its turn in the queue comes', async () => {
  const enqueue = createSerialQueue()
  let pin: string | null = 'cs-1'
  const staged: string[] = []
  const stage = async (changesetId: string) => {
    staged.push(changesetId)
    return { seq: staged.length, id: 'e-1' }
  }
  const first = deferred()
  const a = enqueue('lens', async () => {
    await first.promise
    return stageIntoPinned(() => pin, stage)
  })
  const b = enqueue('lens', () => stageIntoPinned(() => pin, stage))
  pin = 'cs-2' // another changeset pinned while both wait
  first.resolve()
  assert.equal((await a).changesetId, 'cs-2')
  assert.equal((await b).changesetId, 'cs-2')
  assert.deepEqual(staged, ['cs-2', 'cs-2'])
})

test('stageIntoPinned fails a queued write whose changeset was left, without staging it', async () => {
  const enqueue = createSerialQueue()
  let pin: string | null = 'cs-1'
  let calls = 0
  const stage = async () => {
    calls += 1
    return { seq: calls, id: 'e-1' }
  }
  const first = deferred()
  const a = enqueue('lens', async () => {
    await first.promise
    return stageIntoPinned(() => 'cs-1', stage)
  })
  const b = enqueue('lens', () => stageIntoPinned(() => pin, stage))
  pin = null // Leave while b waits
  first.resolve()
  await a
  await assert.rejects(b, new RegExp(LEFT_CHANGESET_TEXT))
  assert.equal(calls, 1)
})
