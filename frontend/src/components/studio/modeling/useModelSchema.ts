/**
 * The one shared read hook of the modeling layer: entity types, relation
 * types and every type's properties of one ontology. The schema surfaces read
 * through it instead of querying these keys themselves.
 */

import { useCallback, useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import type { EntityType, PropertyDefinition, RelationType } from '@/api/types'

export type TypeKind = 'entity-types' | 'relation-types'

const NO_ENTITY_TYPES: EntityType[] = []
const NO_RELATION_TYPES: RelationType[] = []

export interface ModelSchema {
  entityTypes: EntityType[]
  relationTypes: RelationType[]
  /** Properties by owner id (`entityTypeId` / `relationTypeId`); `undefined` while loading. */
  properties: Record<string, PropertyDefinition[] | undefined>
  /** The type lists are still loading. */
  isPending: boolean
  /** Both type lists and every type's properties have loaded. */
  propertiesLoaded: boolean
  /**
   * The first error of a type-list or property query that has no data to show, or null.
   * A failed background refetch keeps the data on screen and is not reported.
   */
  error: Error | null
}

export function useModelSchema(ontologyKey: string): ModelSchema {
  const et = useQuery({
    queryKey: qk.model(ontologyKey, 'entity-types'),
    queryFn: () => model.listEntityTypes(ontologyKey),
  })
  const rt = useQuery({
    queryKey: qk.model(ontologyKey, 'relation-types'),
    queryFn: () => model.listRelationTypes(ontologyKey),
  })

  const owners = useMemo(
    () => [
      ...(et.data ?? []).map((t) => ({ kind: 'entity-types' as const, id: t.entityTypeId })),
      ...(rt.data ?? []).map((t) => ({ kind: 'relation-types' as const, id: t.relationTypeId })),
    ],
    [et.data, rt.data],
  )
  // A stable `combine` keeps the merged result referentially stable between renders.
  const combine = useCallback(
    (results: { data?: PropertyDefinition[]; error: Error | null }[]) => {
      const properties: Record<string, PropertyDefinition[] | undefined> = {}
      owners.forEach((o, i) => (properties[o.id] = results[i]?.data))
      return {
        properties,
        allLoaded: results.every((r) => r.data !== undefined),
        propertiesError: results.find((r) => r.data === undefined && r.error !== null)?.error ?? null,
      }
    },
    [owners],
  )
  const { properties, allLoaded, propertiesError } = useQueries({
    queries: owners.map((o) => ({
      queryKey: qk.model(ontologyKey, o.kind, o.id, 'properties'),
      queryFn: () => model.listProperties(ontologyKey, o.kind, o.id),
    })),
    combine,
  })

  const isPending = et.isPending || rt.isPending
  return {
    entityTypes: et.data ?? NO_ENTITY_TYPES,
    relationTypes: rt.data ?? NO_RELATION_TYPES,
    properties,
    isPending,
    propertiesLoaded: !isPending && allLoaded,
    error: (et.data === undefined ? et.error : null) ?? (rt.data === undefined ? rt.error : null) ?? propertiesError,
  }
}

/** One type of either kind by id, looked up in the shared schema. */
export function findType(
  schema: ModelSchema,
  kind: TypeKind,
  id: string,
): EntityType | RelationType | undefined {
  return kind === 'entity-types'
    ? schema.entityTypes.find((t) => t.entityTypeId === id)
    : schema.relationTypes.find((t) => t.relationTypeId === id)
}

/** One type of either kind by key, looked up in the shared schema. */
export function findTypeByKey(
  schema: ModelSchema,
  kind: TypeKind,
  key: string,
): EntityType | RelationType | undefined {
  const types: (EntityType | RelationType)[] =
    kind === 'entity-types' ? schema.entityTypes : schema.relationTypes
  return types.find((t) => t.key === key)
}
