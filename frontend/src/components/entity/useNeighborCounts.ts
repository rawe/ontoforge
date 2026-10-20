/**
 * Exact per-relation-type neighbor counts for one entity, via cheap
 * `limit=1` relation-list calls (the /neighbors endpoint has no total).
 * Shared by the relation sections and the mini-map; a single cache entry
 * per entity keyed under `neighborCountsKey`.
 */

import { useQuery, type QueryClient } from '@tanstack/react-query'
import * as runtime from '@/api/runtime'
import { qk } from '@/api/queryKeys'
import type { EntityInstance, SchemaRelationType } from '@/api/types'
import type { HierarchyLink } from '@/components/entity/hierarchy'

export const neighborCountsKey = (
  ontologyKey: string,
  lensKey: string,
  entityTypeKey: string,
  id: string,
) => ['neighborCounts', ontologyKey, lensKey, entityTypeKey, id] as const

export function useNeighborCounts(
  ontologyKey: string,
  lensKey: string,
  entity: EntityInstance | undefined,
  relationTypes: readonly SchemaRelationType[],
) {
  return useQuery({
    queryKey: neighborCountsKey(
      ontologyKey,
      lensKey,
      entity?._entityTypeKey ?? '',
      entity?._id ?? '',
    ),
    enabled: entity !== undefined && relationTypes.length > 0,
    queryFn: async (): Promise<Record<string, number>> => {
      const counts: Record<string, number> = {}
      await Promise.all(
        relationTypes.map(async (rt) => {
          let total = 0
          if (rt.fromEntityTypeKey === entity!._entityTypeKey) {
            const res = await runtime.listRelations(ontologyKey, lensKey, rt.key, {
              fromEntityId: entity!._id,
              limit: 1,
            })
            total += res.total
          }
          if (rt.toEntityTypeKey === entity!._entityTypeKey) {
            const res = await runtime.listRelations(ontologyKey, lensKey, rt.key, {
              toEntityId: entity!._id,
              limit: 1,
            })
            total += res.total
          }
          counts[rt.key] = total
        }),
      )
      return counts
    },
  })
}

/**
 * Exact child count per parent relation type where the entity is the parent
 * end (one `limit=1` relation-list call each). Under `neighborCountsKey`, so
 * `invalidateNeighborhood` refreshes it.
 */
export function useChildCounts(
  ontologyKey: string,
  lensKey: string,
  entity: EntityInstance | undefined,
  links: readonly HierarchyLink[],
) {
  return useQuery({
    queryKey: [
      ...neighborCountsKey(ontologyKey, lensKey, entity?._entityTypeKey ?? '', entity?._id ?? ''),
      'children',
    ],
    enabled: entity !== undefined && links.length > 0,
    queryFn: async (): Promise<Record<string, number>> => {
      const counts: Record<string, number> = {}
      await Promise.all(
        links.map(async ({ relationType, direction }) => {
          const res = await runtime.listRelations(ontologyKey, lensKey, relationType.key, {
            ...(direction === 'outgoing'
              ? { fromEntityId: entity!._id }
              : { toEntityId: entity!._id }),
            limit: 1,
          })
          counts[relationType.key] = res.total
        }),
      )
      return counts
    },
  })
}

/** Invalidate everything that renders this entity's neighborhood. */
export function invalidateNeighborhood(
  queryClient: QueryClient,
  ontologyKey: string,
  lensKey: string,
  entityTypeKey: string,
  id: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: qk.neighbors(ontologyKey, lensKey, entityTypeKey, id),
  })
  void queryClient.invalidateQueries({
    queryKey: neighborCountsKey(ontologyKey, lensKey, entityTypeKey, id),
  })
  // A parent relation moves the whole subtree below it.
  void queryClient.invalidateQueries({ queryKey: qk.path(ontologyKey, lensKey) })
}
