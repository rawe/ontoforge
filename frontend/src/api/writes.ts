/**
 * The Workbench's one write seam: instance-data writes go through
 * `useRuntimeWrites`, which writes at once while no changeset is pinned
 * (exactly today's call and answer) and stages into the pinned one
 * otherwise. Callers branch on the outcome's `kind`.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ApiError } from './http'
import { qk } from './queryKeys'
import * as runtime from './runtime'
import {
  createSerialQueue,
  documentWrite,
  isChangesetGone,
  stageIntoPinned,
  stagePayload,
  type RuntimeWrite,
  type StagedOutcome,
  type WriteOutcome,
} from './staging'
import type { EntityInstance, JsonValue, ParentRelationInput, RelationInstance } from './types'
import { pinnedChangeset, unpinChangeset } from '@/lib/pinnedChangeset'
import { storageKeys } from '@/lib/storage'

export type { StagedOutcome, WriteOutcome } from './staging'

/** Said when the pinned changeset turns out to be gone; it is unpinned. */
export const CHANGESET_GONE_TEXT =
  'The changeset is gone (committed, discarded or expired) — you are editing live again'

// One stage call at a time per lens, across every component: a changeset
// answers 409 "busy" to a second call while the first still runs.
const enqueue = createSerialQueue()

export function useRuntimeWrites(ontologyKey: string, lensKey: string) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  return useMemo(() => {
    const pinned = () => pinnedChangeset(ontologyKey, lensKey)
    const stage = async (changesetId: string, write: RuntimeWrite) => {
      try {
        return await runtime.stageWrite(ontologyKey, lensKey, changesetId, stagePayload(write))
      } catch (err) {
        if (err instanceof ApiError && isChangesetGone(err, changesetId)) {
          unpinChangeset(ontologyKey, lensKey)
          toast.warning(CHANGESET_GONE_TEXT)
        }
        throw err
      }
    }

    /** Live while nothing is pinned when the write is called; else staged into the changeset
     * pinned when its turn in the queue comes (never from an older render). */
    async function run<T>(write: RuntimeWrite, immediate: () => Promise<T>): Promise<WriteOutcome<T>> {
      if (pinned() === null) return { kind: 'written', value: await immediate() }
      try {
        return await enqueue(storageKeys.changeset(ontologyKey, lensKey), () =>
          stageIntoPinned(pinned, (changesetId) => stage(changesetId, write)),
        )
      } finally {
        // The list's write count and every page of the changeset's review read.
        void queryClient.invalidateQueries({ queryKey: qk.changesets(ontologyKey, lensKey) })
      }
    }

    return {
      createEntity: (
        entityTypeKey: string,
        properties: Record<string, JsonValue>,
        parentRelation?: ParentRelationInput,
      ): Promise<WriteOutcome<EntityInstance>> =>
        run({ operation: 'create_entity', type: entityTypeKey, properties, parentRelation }, () =>
          runtime.createEntity(ontologyKey, lensKey, entityTypeKey, properties, parentRelation),
        ),
      updateEntity: (
        entityTypeKey: string,
        id: string,
        properties: Record<string, JsonValue | null>,
      ): Promise<WriteOutcome<EntityInstance>> =>
        run({ operation: 'update_entity', type: entityTypeKey, id, properties }, () =>
          runtime.updateEntity(ontologyKey, lensKey, entityTypeKey, id, properties),
        ),
      deleteEntity: (entityTypeKey: string, id: string): Promise<WriteOutcome<undefined>> =>
        run({ operation: 'delete_entity', type: entityTypeKey, id }, () =>
          runtime.deleteEntity(ontologyKey, lensKey, entityTypeKey, id),
        ),
      createRelation: (
        relationTypeKey: string,
        body: { fromEntityId: string; toEntityId: string } & Record<string, JsonValue>,
      ): Promise<WriteOutcome<RelationInstance>> =>
        run({ operation: 'create_relation', type: relationTypeKey, body }, () =>
          runtime.createRelation(ontologyKey, lensKey, relationTypeKey, body),
        ),
      deleteRelation: (relationTypeKey: string, id: string): Promise<WriteOutcome<undefined>> =>
        run({ operation: 'delete_relation', type: relationTypeKey, id }, () =>
          runtime.deleteRelation(ontologyKey, lensKey, relationTypeKey, id),
        ),
      /** Sets one document property to a whole value (null clears it). */
      setDocument: (
        entityTypeKey: string,
        id: string,
        propertyKey: string,
        text: string | null,
      ): Promise<WriteOutcome<EntityInstance>> =>
        run(documentWrite(entityTypeKey, id, propertyKey, text), () =>
          runtime.updateEntity(ontologyKey, lensKey, entityTypeKey, id, { [propertyKey]: text }),
        ),
      /** The staged branch's toast: "Staged #7" (or `text`), with a link to the changeset. */
      toastStaged: (outcome: StagedOutcome, text = `Staged #${outcome.seq}`) =>
        toast.success(text, {
          action: {
            label: 'Open changeset',
            onClick: () => navigate(`/o/${ontologyKey}/w/${lensKey}/changesets/${outcome.changesetId}`),
          },
        }),
    }
  }, [ontologyKey, lensKey, queryClient, navigate])
}
