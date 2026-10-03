import { request } from './http'
import type { EntityIdentityComparison, JsonPrimitive } from './types'

export function compareEntities(
  ontologyKey: string,
  lensKey: string,
  body: { entityTypeKey: string; left: Record<string, JsonPrimitive>; right: Record<string, JsonPrimitive> },
  signal: AbortSignal,
) {
  return request<EntityIdentityComparison>(
    `/api/ontologies/${encodeURIComponent(ontologyKey)}/runtime/lenses/${encodeURIComponent(lensKey)}/decisions/compare-entities`,
    { method: 'POST', body, signal },
  )
}
