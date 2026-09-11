import { useQueries } from '@tanstack/react-query'
import { search } from '@/api/runtime'
import type { SearchHit } from '@/api/types'
import { proposedLabel, type ReviewEntityItem } from '@/components/ai/reviewModel'
import { coerceDraft } from '@/components/schema/propertyDraft'

export interface SimilarLookup {
  /** Per review-entity id: dedupe hits (empty array = none / not applicable). */
  hits: Record<string, SearchHit[]>
  /** True while any lookup is still in flight. */
  pending: boolean
}

/** Query string for one proposed entity — its display-ish props. */
function dedupeQuery(item: ReviewEntityItem): string {
  if (item.type === undefined) return ''
  const props: Record<string, string> = {}
  for (const p of item.type.properties) {
    const draft = item.drafts[p.key]
    if (draft === undefined || draft.trim() === '') continue
    const coerced = coerceDraft(p.dataType, draft)
    if (coerced.ok && coerced.value !== null) props[p.key] = String(coerced.value)
  }
  return proposedLabel(props) === '(unnamed)' ? '' : proposedLabel(props)
}

/**
 * Semantic dedupe for the extract review: per proposed entity, search its
 * own type for existing candidates (limit 3). Pass the
 * INITIAL review items (not live-edited state) so typing in a card doesn't
 * refire searches.
 */
export function useSimilarEntities(
  ontologyKey: string,
  lensKey: string,
  items: readonly ReviewEntityItem[],
  enabled: boolean,
): SimilarLookup {
  const queries = useQueries({
    queries: items.map((item) => {
      const q = dedupeQuery(item)
      return {
        queryKey: ['extract', 'dedupe', ontologyKey, lensKey, item.entityTypeKey, q] as const,
        queryFn: async () => {
          const res = await search(ontologyKey, lensKey, {
            q,
            type: item.entityTypeKey,
            limit: 3,
            in: ['properties'],
          })
          return res.hits
        },
        enabled: enabled && item.type !== undefined && q !== '',
        staleTime: 60_000,
        retry: 1,
      }
    }),
  })

  const hits: Record<string, SearchHit[]> = {}
  let pending = false
  items.forEach((item, i) => {
    const query = queries[i]
    hits[item.id] = query?.data ?? []
    if (query !== undefined && query.isLoading) pending = true
  })
  return { hits, pending }
}
