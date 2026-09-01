/**
 * Review model for AI extraction: turns an `/ai/extract` (create:false)
 * response into editable client-side items. Entities carry property drafts
 * (edited with the shared PropertyField primitives) and an optional
 * "use existing" mapping from semantic dedupe; relations link endpoints to
 * proposed entities by matching the backend's `match` props.
 */

import type {
  ExtractResponse,
  JsonValue,
  RuntimeSchema,
  SchemaEntityType,
  SchemaProperty,
  SchemaRelationType,
} from '@/api/types'
import { valueToDraft } from '@/components/schema/propertyDraft'

export type ItemStatus = 'idle' | 'creating' | 'created' | 'error'

export interface ReviewEntityItem {
  id: string
  entityTypeKey: string
  /** Undefined when the proposed type is not in this lens's scope. */
  type: SchemaEntityType | undefined
  checked: boolean
  /** Drafts for schema properties (string-draft model). */
  drafts: Record<string, string>
  /** Proposed props that don't exist on the schema type — never sent. */
  unknownProps: Record<string, JsonValue>
  /** Existing entity `_id` chosen from dedupe hits; null = create new. */
  useExisting: string | null
  /** Label of the chosen existing entity (for status display). */
  useExistingLabel?: string
  status: ItemStatus
  createdId?: string
  error?: string
  fieldErrors?: Record<string, string>
}

export interface ReviewRelationItem {
  id: string
  relationTypeKey: string
  type: SchemaRelationType | undefined
  /** Local review-entity ids; undefined = endpoint not among proposals. */
  sourceId: string | undefined
  targetId: string | undefined
  sourceLabel: string
  targetLabel: string
  checked: boolean
  drafts: Record<string, string>
  unknownProps: Record<string, JsonValue>
  status: ItemStatus
  error?: string
}

/** Display-ish label from a proposed property bag (mirrors displayLabel). */
export function proposedLabel(properties: Record<string, JsonValue>): string {
  for (const key of ['name', 'title', 'label', 'display_name']) {
    const value = properties[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  for (const value of Object.values(properties)) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return '(unnamed)'
}

function splitProps(
  proposed: Record<string, JsonValue>,
  schemaProps: readonly SchemaProperty[] | undefined,
): { drafts: Record<string, string>; unknown: Record<string, JsonValue> } {
  const drafts: Record<string, string> = {}
  const unknown: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(proposed)) {
    const prop = schemaProps?.find((p) => p.key === key)
    if (prop === undefined) {
      unknown[key] = value
    } else {
      drafts[key] = valueToDraft(prop.dataType, value)
    }
  }
  return { drafts, unknown }
}

/** True when the proposed props satisfy the endpoint's `match` object. */
function matchesEndpoint(
  proposed: Record<string, JsonValue>,
  match: Record<string, JsonValue>,
): boolean {
  return Object.entries(match).every(
    ([key, value]) => String(proposed[key] ?? '') === String(value ?? ''),
  )
}

export interface ReviewModel {
  entities: ReviewEntityItem[]
  relations: ReviewRelationItem[]
}

/** Build the initial review model from an extract response + runtime schema. */
export function buildReviewModel(
  response: ExtractResponse,
  schema: RuntimeSchema,
): ReviewModel {
  const entities = response.entities.map<ReviewEntityItem>((e, i) => {
    const type = schema.entityTypes.find((t) => t.key === e.entityTypeKey)
    const { drafts, unknown } = splitProps(e.properties, type?.properties)
    return {
      id: `e${i}`,
      entityTypeKey: e.entityTypeKey,
      type,
      checked: type !== undefined,
      drafts,
      unknownProps: unknown,
      useExisting: null,
      status: 'idle',
    }
  })

  const relations = response.relations.map<ReviewRelationItem>((r, i) => {
    const type = schema.relationTypes.find((t) => t.key === r.relationTypeKey)
    const findEndpoint = (endpoint: { entityTypeKey: string; match: Record<string, JsonValue> }) =>
      response.entities.findIndex(
        (e, j) =>
          e.entityTypeKey === endpoint.entityTypeKey &&
          matchesEndpoint(e.properties, endpoint.match) &&
          entities[j] !== undefined,
      )
    const sourceIdx = findEndpoint(r.source)
    const targetIdx = findEndpoint(r.target)
    const { drafts, unknown } = splitProps(r.properties, type?.properties)
    return {
      id: `r${i}`,
      relationTypeKey: r.relationTypeKey,
      type,
      sourceId: sourceIdx >= 0 ? entities[sourceIdx].id : undefined,
      targetId: targetIdx >= 0 ? entities[targetIdx].id : undefined,
      sourceLabel: proposedLabel(r.source.match),
      targetLabel: proposedLabel(r.target.match),
      checked: type !== undefined && sourceIdx >= 0 && targetIdx >= 0,
      drafts,
      unknownProps: unknown,
      status: 'idle',
    }
  })

  return { entities, relations }
}

/** Required schema props whose draft is empty and that have no default. */
export function missingRequired(item: ReviewEntityItem): SchemaProperty[] {
  if (item.type === undefined) return []
  return item.type.properties.filter(
    (p) =>
      p.required &&
      p.defaultValue === null &&
      (item.drafts[p.key] ?? '').trim() === '',
  )
}

/**
 * Why a relation cannot be created right now, or null when it can.
 * An endpoint works when its entity is checked (will be / was created) OR is
 * mapped to an existing entity — unchecked and unmapped blocks the relation.
 */
export function relationBlocker(
  relation: ReviewRelationItem,
  entitiesById: ReadonlyMap<string, ReviewEntityItem>,
): string | null {
  if (relation.type === undefined) {
    return `Relation type "${relation.relationTypeKey}" is not in this lens's scope.`
  }
  const check = (id: string | undefined, label: string, side: string): string | null => {
    if (id === undefined) return `${side} "${label}" is not among the proposed entities.`
    const entity = entitiesById.get(id)
    if (entity === undefined) return `${side} "${label}" is missing.`
    if (entity.useExisting !== null) return null
    if (entity.status === 'created') return null
    if (!entity.checked) {
      return `${side} "${label}" is unchecked and not mapped to an existing entity.`
    }
    return null
  }
  return (
    check(relation.sourceId, relation.sourceLabel, 'Source') ??
    check(relation.targetId, relation.targetLabel, 'Target')
  )
}

/** Fields worth showing on a review card: proposed (non-empty) or required. */
export function visibleProperties(item: ReviewEntityItem): SchemaProperty[] {
  if (item.type === undefined) return []
  return item.type.properties.filter(
    (p) => p.required || (item.drafts[p.key] ?? '') !== '',
  )
}
