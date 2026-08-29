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

export const neighborCountsKey = (
  lensKey: string,
  entityTypeKey: string,
  id: string,
) => ['neighborCounts', lensKey, entityTypeKey, id] as const

export function useNeighborCounts(
  lensKey: string,
  entity: EntityInstance | undefined,
  relationTypes: readonly SchemaRelationType[],
) {
  return useQuery({
    queryKey: neighborCountsKey(
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
            const res = await runtime.listRelations(lensKey, rt.key, {
              fromEntityId: entity!._id,
              limit: 1,
            })
            total += res.total
          }
          if (rt.toEntityTypeKey === entity!._entityTypeKey) {
            const res = await runtime.listRelations(lensKey, rt.key, {
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

/** Invalidate everything that renders this entity's neighborhood. */
export function invalidateNeighborhood(
  queryClient: QueryClient,
  lensKey: string,
  entityTypeKey: string,
  id: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: qk.neighbors(lensKey, entityTypeKey, id),
  })
  void queryClient.invalidateQueries({
    queryKey: neighborCountsKey(lensKey, entityTypeKey, id),
  })
}
