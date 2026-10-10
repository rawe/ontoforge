/**
 * The schema search — pure, unit-tested with `node --test`. One query matches
 * keys and display names of types and properties (case-insensitive
 * substring). The outline filters by it, the graph highlights by it.
 */

import type { ModelSchema } from './useModelSchema'

export interface SearchMatches {
  /** False for an empty query: nothing is filtered or highlighted. */
  active: boolean
  /** Entity types that match themselves or through one of their properties. */
  entityIds: Set<string>
  /** Relation types that match themselves or through one of their properties. */
  relationIds: Set<string>
  /** Properties that match; their owners are in the sets above. */
  propertyIds: Set<string>
}

export function searchSchema(
  schema: Pick<ModelSchema, 'entityTypes' | 'relationTypes' | 'properties'>,
  query: string,
): SearchMatches {
  const q = query.trim().toLowerCase()
  const out: SearchMatches = {
    active: q !== '',
    entityIds: new Set(),
    relationIds: new Set(),
    propertyIds: new Set(),
  }
  if (q === '') return out
  const hit = (...fields: (string | null)[]) => fields.some((f) => (f ?? '').toLowerCase().includes(q))
  const scan = (ownerId: string, ownerHit: boolean, into: Set<string>) => {
    let match = ownerHit
    for (const p of schema.properties[ownerId] ?? []) {
      if (hit(p.key, p.displayName)) {
        out.propertyIds.add(p.propertyId)
        match = true
      }
    }
    if (match) into.add(ownerId)
  }
  for (const t of schema.entityTypes) scan(t.entityTypeId, hit(t.key, t.displayName), out.entityIds)
  for (const r of schema.relationTypes) scan(r.relationTypeId, hit(r.key, r.displayName), out.relationIds)
  return out
}
