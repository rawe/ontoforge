/**
 * Pure helpers for Cypher / saved-query results: entity/relation guards,
 * `$param` detection, CSV export and graph derivation. No React.
 */

import { ApiError } from '@/api/http'
import type {
  EntityInstance,
  JsonValue,
  QueryResult,
  SchemaRelationType,
} from '@/api/types'

/**
 * Full error text for a failed query run. The backend's self-correction
 * hints (available types/properties) arrive in `details.errors` — surface
 * them verbatim below the envelope message.
 */
export function formatQueryError(err: unknown): string {
  if (err instanceof ApiError) {
    const hints = err.details?.errors
    if (Array.isArray(hints) && hints.length > 0) {
      return [err.message, ...hints.map(String)].join('\n')
    }
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}

/**
 * Relation object as it appears in query results. NOTE: unlike the REST
 * relation endpoints, Cypher results do NOT include `fromEntityId` /
 * `toEntityId` — treat endpoints as optional.
 */
export interface QueryRelationObject {
  _id: string
  _relationTypeKey: string
  fromEntityId?: string
  toEntityId?: string
  [property: string]: JsonValue | undefined
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function isEntityObject(value: unknown): value is EntityInstance {
  return (
    isPlainObject(value) &&
    typeof value._id === 'string' &&
    typeof value._entityTypeKey === 'string'
  )
}

export function isRelationObject(value: unknown): value is QueryRelationObject {
  return (
    isPlainObject(value) &&
    typeof value._id === 'string' &&
    typeof value._relationTypeKey === 'string'
  )
}

/** User-facing (non-underscore, non-endpoint) props of a relation object. */
export function relationUserProps(relation: QueryRelationObject): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(relation)) {
    if (key.startsWith('_') || key === 'fromEntityId' || key === 'toEntityId') continue
    if (value !== undefined) out[key] = value
  }
  return out
}

/* --------------------------------- $params ---------------------------------- */

/** Unique `$param` tokens in a Cypher string, in order of appearance. */
export function detectParams(cypher: string): string[] {
  const names: string[] = []
  for (const match of cypher.matchAll(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
    const name = match[1]!
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/* ----------------------------------- CSV ------------------------------------ */

function csvCell(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Client-side CSV download of a result set; objects are JSON-stringified. */
export function exportResultsCsv(result: QueryResult, filename: string): void {
  const lines = [result.columns.map(csvCell).join(',')]
  for (const row of result.results) {
    lines.push(result.columns.map((c) => csvCell(row[c])).join(','))
  }
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/* ---------------------------------- graph ----------------------------------- */

export interface DerivedEdge {
  /** Relation instance id. */
  id: string
  relationTypeKey: string
  sourceEntityId: string
  targetEntityId: string
}

export interface DerivedGraph {
  entities: EntityInstance[]
  edges: DerivedEdge[]
}

/** True when any cell of any row is an entity object — gates the Graph toggle. */
export function hasEntityResults(result: QueryResult): boolean {
  return result.results.some((row) =>
    result.columns.some((c) => isEntityObject(row[c])),
  )
}

/**
 * Derive a graph from result rows: nodes are the unique entities, edges come
 * from relation objects. Cypher results carry no endpoint ids on relations,
 * so endpoints are resolved per row — explicit `fromEntityId`/`toEntityId`
 * when present, otherwise the schema's from/to entity types matched against
 * the entities of the same row. Ambiguous or unresolvable relations are
 * skipped rather than guessed.
 */
export function deriveGraph(
  result: QueryResult,
  relationTypes: readonly SchemaRelationType[],
): DerivedGraph {
  const entitiesById = new Map<string, EntityInstance>()
  const edgesById = new Map<string, DerivedEdge>()

  for (const row of result.results) {
    const rowEntities: EntityInstance[] = []
    const rowRelations: QueryRelationObject[] = []
    for (const column of result.columns) {
      const value = row[column]
      if (isEntityObject(value)) {
        if (!entitiesById.has(value._id)) entitiesById.set(value._id, value)
        rowEntities.push(value)
      } else if (isRelationObject(value)) {
        rowRelations.push(value)
      }
    }

    for (const relation of rowRelations) {
      if (edgesById.has(relation._id)) continue

      let sourceId: string | undefined
      let targetId: string | undefined
      if (
        typeof relation.fromEntityId === 'string' &&
        typeof relation.toEntityId === 'string'
      ) {
        sourceId = relation.fromEntityId
        targetId = relation.toEntityId
      } else {
        const schemaType = relationTypes.find((t) => t.key === relation._relationTypeKey)
        if (schemaType === undefined) continue
        const sources = rowEntities.filter(
          (e) => e._entityTypeKey === schemaType.fromEntityTypeKey,
        )
        const targets = rowEntities.filter(
          (e) =>
            e._entityTypeKey === schemaType.toEntityTypeKey &&
            // self-referencing types: don't connect an entity to itself
            (schemaType.fromEntityTypeKey !== schemaType.toEntityTypeKey ||
              sources.length === 0 ||
              e._id !== sources[0]!._id),
        )
        if (sources.length !== 1 || targets.length !== 1) continue
        sourceId = sources[0]!._id
        targetId = targets[0]!._id
      }

      if (!entitiesById.has(sourceId) || !entitiesById.has(targetId)) continue
      edgesById.set(relation._id, {
        id: relation._id,
        relationTypeKey: relation._relationTypeKey,
        sourceEntityId: sourceId,
        targetEntityId: targetId,
      })
    }
  }

  return { entities: [...entitiesById.values()], edges: [...edgesById.values()] }
}
