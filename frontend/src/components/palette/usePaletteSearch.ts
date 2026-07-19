/**
 * Debounce + server-search hooks shared by the Cmd+K palette and the
 * relation target picker on the entity detail page.
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import * as runtime from '@/api/runtime'
import type { EntityInstance, SavedQuery, SearchMatchedVia } from '@/api/types'

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

export interface EntitySearchResult {
  entity: EntityInstance
  /** Only present for semantic results (RRF fusion score — ordering only). */
  score?: number
  /** Only present for semantic results; carries the raw cosine similarity. */
  matchedVia?: SearchMatchedVia
}

export interface EntitySearchOptions {
  ontologyKey: string
  /** Debounced, prefix-stripped query. */
  q: string
  /** Restrict to one entity type (scoped mode / target picker). */
  typeKey?: string
  /** Whether the backend has semantic search enabled. */
  semantic: boolean
  /** All in-scope entity type keys — used for the cross-type substring fallback. */
  allTypeKeys: readonly string[]
  enabled: boolean
  limit?: number
}

/**
 * Entity search. Semantic (cross-type or `type=`-scoped) when available and
 * the query has ≥2 chars; substring `q` queries otherwise (parallel per-type
 * when unscoped). An empty query with a typeKey lists the first entities of
 * that type; an empty unscoped query returns nothing.
 */
export function useEntitySearch({
  ontologyKey,
  q,
  typeKey,
  semantic,
  allTypeKeys,
  enabled,
  limit = 15,
}: EntitySearchOptions) {
  return useQuery({
    queryKey: [
      'palette',
      'entitySearch',
      ontologyKey,
      typeKey ?? '*',
      q,
      semantic,
      limit,
    ],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<EntitySearchResult[]> => {
      if (q === '') {
        if (typeKey === undefined) return []
        const res = await runtime.listEntities(ontologyKey, typeKey, { limit: 10 })
        return res.items.map((entity) => ({ entity }))
      }
      if (semantic && q.length >= 2) {
        const res = await runtime.semanticSearch(ontologyKey, {
          q,
          ...(typeKey !== undefined ? { type: typeKey } : {}),
          limit,
        })
        return res.results.map(({ entity, score, matchedVia }) => ({
          entity,
          score,
          matchedVia,
        }))
      }
      if (typeKey !== undefined) {
        const res = await runtime.listEntities(ontologyKey, typeKey, { q, limit })
        return res.items.map((entity) => ({ entity }))
      }
      const settled = await Promise.allSettled(
        allTypeKeys.map((t) => runtime.listEntities(ontologyKey, t, { q, limit: 5 })),
      )
      return settled.flatMap((s) =>
        s.status === 'fulfilled' ? s.value.items.map((entity) => ({ entity })) : [],
      )
    },
  })
}

/**
 * Saved-query lookup for the `?` palette mode. Empty query → full list;
 * otherwise semantic search when available, substring filter when not.
 */
export function useSavedQuerySearch(
  ontologyKey: string,
  q: string,
  semantic: boolean,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['palette', 'savedQuerySearch', ontologyKey, q, semantic],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SavedQuery[]> => {
      if (q === '') return runtime.listSavedQueries(ontologyKey)
      if (semantic && q.length >= 2) {
        return runtime.searchSavedQueries(ontologyKey, { q, limit: 10, minScore: 0.3 })
      }
      const all = await runtime.listSavedQueries(ontologyKey)
      const needle = q.toLowerCase()
      return all.filter(
        (sq) =>
          sq.name.toLowerCase().includes(needle) ||
          sq.key.toLowerCase().includes(needle) ||
          (sq.description ?? '').toLowerCase().includes(needle),
      )
    },
  })
}
