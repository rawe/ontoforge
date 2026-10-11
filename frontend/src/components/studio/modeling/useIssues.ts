/**
 * The schema's lint issues (`lint.ts`) for one ontology, recomputed from the
 * shared schema cache whenever it changes — no request of its own.
 */

import { useMemo } from 'react'
import { lintSchema, type Issue } from './lint'
import { useModelSchema } from './useModelSchema'

export interface Issues {
  issues: Issue[]
  /** Issue count per type id (`entityTypeId` / `relationTypeId`), its properties' issues included. */
  countByType: ReadonlyMap<string, number>
  /** Properties with an issue. */
  propertyIds: ReadonlySet<string>
}

export function useIssues(ontologyKey: string): Issues {
  const { entityTypes, relationTypes, properties } = useModelSchema(ontologyKey)
  return useMemo(() => {
    const issues = lintSchema({ entityTypes, relationTypes, properties })
    const countByType = new Map<string, number>()
    const propertyIds = new Set<string>()
    for (const i of issues) {
      countByType.set(i.typeId, (countByType.get(i.typeId) ?? 0) + 1)
      if (i.propertyId !== undefined) propertyIds.add(i.propertyId)
    }
    return { issues, countByType, propertyIds }
  }, [entityTypes, relationTypes, properties])
}
