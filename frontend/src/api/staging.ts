/**
 * The pure part of the Workbench's write seam (`api/writes.ts`): a write as
 * the immediate API takes it, the stage payload built from it, the outcome a
 * write answers, and the queue that stages one write at a time into the
 * pinned changeset. No React, no I/O — unit-tested with `node --test`.
 */

import type {
  EntityInstance,
  JsonValue,
  ParentRelationInput,
  StagedAnswer,
  StageWritePayload,
} from './types.ts'

/** A Workbench write with the arguments of its immediate call (flat values). */
export type RuntimeWrite =
  | {
      operation: 'create_entity'
      type: string
      properties: Record<string, JsonValue>
      parentRelation?: ParentRelationInput
    }
  | { operation: 'update_entity'; type: string; id: string; properties: Record<string, JsonValue | null> }
  | { operation: 'delete_entity'; type: string; id: string }
  | {
      operation: 'create_relation'
      type: string
      body: { fromEntityId: string; toEntityId: string } & Record<string, JsonValue>
    }
  | { operation: 'delete_relation'; type: string; id: string }

/** A write staged into a changeset: its seq and the minted (create) or target id. */
export interface StagedOutcome extends StagedAnswer {
  kind: 'staged'
  changesetId: string
}

/** What a write through the seam answers: the immediate write's value, or where it was staged. */
export type WriteOutcome<T> = { kind: 'written'; value: T } | StagedOutcome

/** The stage body of a write: its values nested under `properties`, a parent relation carried. */
export function stagePayload(write: RuntimeWrite): StageWritePayload {
  switch (write.operation) {
    case 'create_entity':
      return write.parentRelation === undefined
        ? { operation: write.operation, type: write.type, properties: write.properties }
        : {
            operation: write.operation,
            type: write.type,
            properties: write.properties,
            parentRelation: write.parentRelation,
          }
    case 'update_entity':
      return { operation: write.operation, type: write.type, id: write.id, properties: write.properties }
    case 'create_relation': {
      const { fromEntityId, toEntityId, ...properties } = write.body
      return { operation: write.operation, type: write.type, fromEntityId, toEntityId, properties }
    }
    case 'delete_entity':
    case 'delete_relation':
      return { operation: write.operation, type: write.type, id: write.id }
  }
}

export function stagedOutcome(changesetId: string, answer: StagedAnswer): StagedOutcome {
  return { kind: 'staged', changesetId, ...answer }
}

/**
 * A display-only stand-in for an entity a changeset creates: the typed
 * values under the minted id, so a flow can name it and link to it. Never
 * put into a cache — reads do not see staged data.
 */
export function stagedEntity(type: string, id: string, properties: Record<string, JsonValue>): EntityInstance {
  return { ...properties, _id: id, _entityTypeKey: type, _createdAt: '', _updatedAt: '' }
}

/**
 * The write that sets one document property: today the whole value (null
 * clears it), as an entity update. Document edits go through here only, so
 * a partial document write can replace it later.
 */
export function documentWrite(type: string, id: string, propertyKey: string, text: string | null): RuntimeWrite {
  return { operation: 'update_entity', type, id, properties: { [propertyKey]: text } }
}

/** Why a queued write failed: its changeset was left while it waited. */
export const LEFT_CHANGESET_TEXT = 'You left the changeset before this write was staged: nothing was written'

/**
 * Stages into the changeset pinned when this runs — a queued write runs
 * after the ones before it. Nothing pinned by then fails the write: it is
 * never written live instead.
 */
export async function stageIntoPinned(
  pinned: () => string | null,
  stage: (changesetId: string) => Promise<StagedAnswer>,
): Promise<StagedOutcome> {
  const changesetId = pinned()
  if (changesetId === null) throw new Error(LEFT_CHANGESET_TEXT)
  return stagedOutcome(changesetId, await stage(changesetId))
}

/** Whether a stage call's error says the changeset itself is gone (committed, discarded, expired). */
export function isChangesetGone(error: { status: number; message: string }, changesetId: string): boolean {
  return error.status === 404 && error.message.includes(`Changeset '${changesetId}'`)
}

/**
 * Runs tasks one after another per key; tasks of different keys run side by
 * side. A failed task does not stop the next one. A changeset answers 409
 * "busy" to a second stage call while the first still runs.
 */
export function createSerialQueue(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>()
  return <T>(key: string, task: () => Promise<T>) => {
    const result = (tails.get(key) ?? Promise.resolve()).then(task)
    const tail = result.catch(() => undefined)
    tails.set(key, tail)
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })
    return result
  }
}
