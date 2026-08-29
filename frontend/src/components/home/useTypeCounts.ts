import { useQueries } from '@tanstack/react-query'
import { listEntities } from '@/api/runtime'
import type { SchemaEntityType } from '@/api/types'

export interface TypeCounts {
  /** Per-type instance count; undefined while that type's query is loading. */
  counts: Record<string, number | undefined>
  /** True once every count query has settled. */
  loaded: boolean
  /** Sum of all loaded counts. */
  total: number
}

/**
 * Live per-type instance counts via one minimal entity-list request per
 * entity type (`limit=1`, reading the pagination `total`), run in parallel
 * and cached for 30s. Keys align with the `entities` query-key family so
 * bulk mutations invalidate them too.
 */
export function useTypeCounts(
  lensKey: string | undefined,
  entityTypes: readonly SchemaEntityType[],
): TypeCounts {
  const results = useQueries({
    queries: entityTypes.map((t) => ({
      queryKey: ['entities', lensKey ?? '', t.key, 'count'] as const,
      queryFn: async () => {
        const res = await listEntities(lensKey!, t.key, { limit: 1 })
        return res.total
      },
      enabled: lensKey !== undefined,
      staleTime: 30_000,
    })),
  })

  const counts: Record<string, number | undefined> = {}
  let loaded = true
  let total = 0
  entityTypes.forEach((t, i) => {
    const r = results[i]
    counts[t.key] = r?.data
    if (r === undefined || r.isPending) loaded = false
    total += r?.data ?? 0
  })
  return { counts, loaded: loaded && entityTypes.length > 0, total }
}
