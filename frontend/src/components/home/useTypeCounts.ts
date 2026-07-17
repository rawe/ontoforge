import { useQueries } from '@tanstack/react-query'
import { cypherQuery } from '@/api/runtime'
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
 * Live per-type instance counts via one cheap Cypher count query per entity
 * type, run in parallel and cached for 30s. Keys align with the `entities`
 * query-key family so bulk mutations invalidate them too.
 */
export function useTypeCounts(
  ontologyKey: string | undefined,
  entityTypes: readonly SchemaEntityType[],
): TypeCounts {
  const results = useQueries({
    queries: entityTypes.map((t) => ({
      queryKey: ['entities', ontologyKey ?? '', t.key, 'count'] as const,
      queryFn: async () => {
        const res = await cypherQuery(ontologyKey!, `MATCH (n:${t.key}) RETURN count(n) AS c`)
        const c = res.results[0]?.['c']
        return typeof c === 'number' ? c : 0
      },
      enabled: ontologyKey !== undefined,
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
