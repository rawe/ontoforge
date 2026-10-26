/**
 * The modeling layer's write hooks. Every surface that changes a type or a
 * property goes through these; nothing about it exists twice.
 *
 * Invalidation: structural writes (creating a type, name property, deletes,
 * anything sent with `cascade=true`) refetch every modeling cache. Field updates and a
 * property added without cascade only mark them stale and refetch the one
 * list they change, so a small edit does not refetch every property list.
 * Deletes leave their errors to the delete dialog (blocked, cascade);
 * creating a type leaves its field errors to the caller.
 */

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import type {
  EntityType,
  EntityTypeInput,
  ParentEnd,
  PropertyDefinition,
  PropertyInput,
  PropertyUpdate,
  RelationType,
  RelationTypeInput,
} from '@/api/types'
import { invalidateModeling, toastError } from '../lib'
import { useCascadeGuard } from './cascadeContext'
import { relationRuleViolationsOf } from './errors'
import { IDENTITY_CASCADE_NOTE, identityViolationsOf } from './identity'
import type { TypeKind } from './useModelSchema'

/**
 * Create an entity type. `create` resolves with the new type; on an error it
 * toasts and rejects, so the caller can map the field errors. Where to go
 * next is the caller's choice.
 */
export function useCreateEntityType(ontologyKey: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (body: EntityTypeInput) => model.createEntityType(ontologyKey, body),
    onSuccess: (created) => {
      // In the list at once, so selecting it does not meet a stale list (not found).
      queryClient.setQueryData<EntityType[]>(qk.model(ontologyKey, 'entity-types'), (old) =>
        old === undefined ? old : [...old, created],
      )
      invalidateModeling(queryClient)
      toast.success(`Entity type "${created.displayName}" created`)
    },
    onError: toastError,
  })
  return {
    create: (body: EntityTypeInput) => mutation.mutateAsync(body),
    isPending: mutation.isPending,
  }
}

/** Create a relation type — same contract as `useCreateEntityType`. */
export function useCreateRelationType(ontologyKey: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (body: RelationTypeInput) => model.createRelationType(ontologyKey, body),
    onSuccess: (created) => {
      queryClient.setQueryData<RelationType[]>(qk.model(ontologyKey, 'relation-types'), (old) =>
        old === undefined ? old : [...old, created],
      )
      invalidateModeling(queryClient)
      toast.success(`Relation type "${created.displayName}" created`)
    },
    onError: toastError,
  })
  return {
    create: (body: RelationTypeInput) => mutation.mutateAsync(body),
    isPending: mutation.isPending,
  }
}

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

/**
 * Set, flip or clear (`null`) a relation type's parent end. A refusal for
 * broken parent rules is not toasted: the caller shows its report from the
 * mutation's error (`relationRuleViolationsOf`).
 */
export function useSetParent(ontologyKey: string, relationTypeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (parent: ParentEnd | null) =>
      model.updateRelationType(ontologyKey, relationTypeId, { parent }),
    onSuccess: (saved) => {
      invalidateModeling(queryClient)
      toast.success(saved.parent === null ? 'Parent relation cleared' : 'Parent end saved')
    },
    onError: (error) => {
      if (relationRuleViolationsOf(error) === null) toastError(error)
    },
  })
}

/**
 * Turn a relation type's one per pair on or off. A refusal by the stored
 * data (a pair linked twice) is not toasted: the caller shows its report from
 * the mutation's error (`relationRuleViolationsOf`).
 */
export function useSetOnePerPair(ontologyKey: string, relationTypeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (onePerPair: boolean) =>
      model.updateRelationType(ontologyKey, relationTypeId, { onePerPair }),
    onSuccess: (saved) => {
      invalidateModeling(queryClient)
      toast.success(saved.onePerPair ? 'One per pair turned on' : 'One per pair turned off')
    },
    onError: (error) => {
      if (relationRuleViolationsOf(error) === null) toastError(error)
    },
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

/**
 * Set or clear (`null`) an entity type's identity. A needed cascade opens
 * the page's cascade dialog, which re-sends it with `cascade=true`; a
 * refusal by the stored data is not toasted: the caller shows its report
 * from the mutation's error (`identityViolationsOf`).
 */
export function useSetIdentity(ontologyKey: string, entityTypeId: string) {
  const queryClient = useQueryClient()
  const guard = useCascadeGuard()
  const mutation = useMutation({
    mutationFn: ({ identityProperties, cascade }: { identityProperties: string[] | null; cascade: boolean }) =>
      model.updateEntityType(ontologyKey, entityTypeId, { identityProperties }, cascade),
    onSuccess: (saved) => {
      invalidateModeling(queryClient)
      toast.success(saved.identityProperties === null ? 'Identity cleared' : 'Identity saved')
    },
  })
  const set = (identityProperties: string[] | null, cascade = false) => {
    mutation.mutateAsync({ identityProperties, cascade }).catch((error: unknown) => {
      if (guard(error, () => set(identityProperties, true), IDENTITY_CASCADE_NOTE)) return
      if (identityViolationsOf(error) === null) toastError(error)
    })
  }
  return { set, error: mutation.error, isPending: mutation.isPending, reset: mutation.reset }
}

/** Mark every modeling cache stale, then refetch only one type's property list. */
function refetchProperties(
  queryClient: QueryClient,
  ontologyKey: string,
  kind: TypeKind,
  typeId: string,
) {
  invalidateModeling(queryClient, 'none')
  void queryClient.refetchQueries({
    queryKey: qk.model(ontologyKey, kind, typeId, 'properties'),
    exact: true,
    type: 'active',
  })
}

export interface CreatePropertyCallbacks {
  /** After the property exists — also after a cascade retry. */
  onSuccess?: (saved: PropertyDefinition) => void
  /** Any error but a cascade conflict (already toasted). Cancelling the cascade calls nothing. */
  onError?: (error: unknown) => void
}

/**
 * Add a property to a type of either kind. A `CASCADE_REQUIRED` conflict (a
 * required property without default, listed by a lens allowlist) opens the
 * page's cascade dialog, which re-sends it with `cascade=true`. Built on
 * `mutateAsync`, so the toasts and the cascade dialog do not depend on the
 * calling component staying mounted.
 */
export function useCreateProperty(ontologyKey: string, kind: TypeKind, typeId: string) {
  const queryClient = useQueryClient()
  const guard = useCascadeGuard()
  const mutation = useMutation({
    mutationFn: ({ body, cascade }: { body: PropertyInput; cascade: boolean }) =>
      model.createProperty(ontologyKey, kind, typeId, body, cascade),
    onSuccess: (saved, { cascade }) => {
      if (cascade) invalidateModeling(queryClient)
      else refetchProperties(queryClient, ontologyKey, kind, typeId)
      toast.success(`Property "${saved.key}" added`)
    },
  })
  const create = (body: PropertyInput, callbacks: CreatePropertyCallbacks = {}, cascade = false) => {
    mutation.mutateAsync({ body, cascade }).then(callbacks.onSuccess, (error: unknown) => {
      if (guard(error, () => create(body, callbacks, true))) return
      toastError(error)
      callbacks.onError?.(error)
    })
  }
  return { create, isPending: mutation.isPending }
}

/**
 * Change one property, sent sparse: display name, description, required or
 * default (`defaultValue: null` clears it). Errors are toasted.
 */
export function useUpdateProperty(ontologyKey: string, kind: TypeKind, typeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ propertyId, patch }: { propertyId: string; patch: PropertyUpdate }) =>
      model.updateProperty(ontologyKey, kind, typeId, propertyId, patch),
    onSuccess: (saved) => {
      refetchProperties(queryClient, ontologyKey, kind, typeId)
      toast.success(`Property "${saved.key}" updated`)
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
