/**
 * The modeling layer's write hooks. Every surface that changes a type or a
 * property goes through these; nothing about it exists twice.
 *
 * Invalidation: structural writes (name property, deletes) refetch every
 * modeling cache. Field updates only mark them stale and refetch the one list
 * they change, so a small edit does not refetch every property list.
 * Deletes leave their errors to the delete dialog (blocked, cascade).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import type { EntityType, RelationType } from '@/api/types'
import { invalidateModeling, toastError } from '../lib'
import type { TypeKind } from './useModelSchema'

/** Display name and description of either kind, sent sparse. */
export function useUpdateType(ontologyKey: string, kind: TypeKind, typeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: { displayName?: string; description?: string }): Promise<unknown> =>
      kind === 'entity-types'
        ? model.updateEntityType(ontologyKey, typeId, patch)
        : model.updateRelationType(ontologyKey, typeId, patch),
    onSuccess: () => {
      invalidateModeling(queryClient, 'none')
      void queryClient.refetchQueries({
        queryKey: qk.model(ontologyKey, kind),
        exact: true,
        type: 'active',
      })
      toast.success('Saved')
    },
    onError: toastError,
  })
}

/** Reassign an entity type's name property to another of its string properties. */
export function useSetNameProperty(ontologyKey: string, entityTypeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (nameProperty: string) =>
      model.updateEntityType(ontologyKey, entityTypeId, { nameProperty }),
    onSuccess: (saved) => {
      invalidateModeling(queryClient)
      toast.success(`Name property set to "${saved.nameProperty}"`)
    },
    onError: toastError,
  })
}

/** Delete a type of either kind. Errors go to the caller (the delete dialog). */
export function useDeleteType(ontologyKey: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, id, cascade }: { kind: TypeKind; id: string; cascade: boolean }) =>
      kind === 'entity-types'
        ? model.deleteEntityType(ontologyKey, id, cascade)
        : model.deleteRelationType(ontologyKey, id, cascade),
    onSuccess: (_, { kind, id }) => {
      // Drop the type before refetching, so nothing re-reads it or its properties.
      queryClient.setQueryData<(EntityType | RelationType)[]>(qk.model(ontologyKey, kind), (old) =>
        old?.filter((t) => ('entityTypeId' in t ? t.entityTypeId : t.relationTypeId) !== id),
      )
      queryClient.removeQueries({ queryKey: qk.model(ontologyKey, kind, id, 'properties') })
      invalidateModeling(queryClient)
      toast.success(`${kind === 'entity-types' ? 'Entity' : 'Relation'} type deleted`)
    },
  })
}

/** Delete a property of either kind's type. Errors go to the caller (the delete dialog). */
export function useDeleteProperty(ontologyKey: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { kind: TypeKind; typeId: string; propertyId: string; cascade: boolean }) =>
      model.deleteProperty(ontologyKey, v.kind, v.typeId, v.propertyId, v.cascade),
    onSuccess: () => {
      invalidateModeling(queryClient)
      toast.success('Property deleted')
    },
  })
}
