/**
 * Filter model for the type tables. A `FilterCondition` is one applied chip
 * on one subject: a property of the listed type, or a relation type in one
 * direction. Operators are constrained per subject; conditions serialize to
 * the runtime entity list's `filter.{key}` / `filter.{key}__{op}` params —
 * "between" expands into a `__gte` + `__lte` pair on the same property.
 *
 * The table offers a subset of the server's filter vocabulary, listed together
 * with what it leaves out in the product surface doc ("Type table"). The
 * per-operator tables below are exhaustive records, so an operator added to
 * `FilterOpUi` does not compile until it has a label, a value shape and a
 * serialization.
 */

import type {
  DataType,
  NeighborDirection,
  SchemaEntityType,
  SchemaProperty,
  SchemaRelationType,
} from '@/api/types'
import { humanDate, humanDateTime } from './format'

export type FilterOpUi =
  | 'contains'
  | 'eq'
  | 'ne'
  | 'gte'
  | 'lte'
  | 'between'
  | 'is'
  | 'exists'
  | 'missing'

/** The operators a relation subject takes: existence only. */
export type RelationFilterOp = Extract<FilterOpUi, 'exists' | 'missing'>

export type RelationDirection = Exclude<NeighborDirection, 'both'>

export type FilterSubject =
  | { kind: 'property'; propertyKey: string }
  | { kind: 'relation'; relationTypeKey: string; direction: RelationDirection }

export interface FilterCondition {
  /** Local unique id for chip removal. */
  id: string
  subject: FilterSubject
  op: FilterOpUi
  value: string
  /** Upper bound, only for `between`. */
  value2?: string
}

/** A relation type the listed type can be filtered by, in one direction. */
export interface RelationSubject {
  relationType: SchemaRelationType
  direction: RelationDirection
  /** The entity type at the relation's other end. */
  otherType: SchemaEntityType
}

/** Everything a filter can name for one listed type. */
export interface FilterSubjects {
  properties: readonly SchemaProperty[]
  relations: readonly RelationSubject[]
}

/**
 * The subject's filter key: a property key, or `relationTypeKey:out|in`. The
 * direction marker is always sent — a self-relation requires it, and it keeps
 * a relation type apart from a property sharing its key. No schema key holds
 * a colon, so the two forms never collide.
 */
export function subjectKey(subject: FilterSubject): string {
  return subject.kind === 'property'
    ? subject.propertyKey
    : `${subject.relationTypeKey}:${subject.direction === 'outgoing' ? 'out' : 'in'}`
}

export function relationSubject(relation: RelationSubject): FilterSubject {
  return {
    kind: 'relation',
    relationTypeKey: relation.relationType.key,
    direction: relation.direction,
  }
}

/**
 * The relation subjects of `typeKey`: one per direction in which a relation
 * type touches it, so a self-relation contributes two. A relation type whose
 * other end the lens hides is skipped — the server rejects filtering by it.
 */
export function relationSubjects(
  typeKey: string,
  relationTypes: readonly SchemaRelationType[],
  entityTypes: readonly SchemaEntityType[],
): RelationSubject[] {
  const typesByKey = new Map(entityTypes.map((t) => [t.key, t]))
  const out: RelationSubject[] = []
  for (const relationType of relationTypes) {
    const target = typesByKey.get(relationType.toEntityTypeKey)
    const source = typesByKey.get(relationType.fromEntityTypeKey)
    if (relationType.fromEntityTypeKey === typeKey && target !== undefined) {
      out.push({ relationType, direction: 'outgoing', otherType: target })
    }
    if (relationType.toEntityTypeKey === typeKey && source !== undefined) {
      out.push({ relationType, direction: 'incoming', otherType: source })
    }
  }
  return out
}

const ORDERED_OPS: readonly FilterOpUi[] = ['eq', 'ne', 'gte', 'lte', 'between', 'exists', 'missing']

const PROPERTY_OPS: Record<DataType, readonly FilterOpUi[]> = {
  string: ['contains', 'eq', 'ne', 'exists', 'missing'],
  integer: ORDERED_OPS,
  float: ORDERED_OPS,
  date: ORDERED_OPS,
  datetime: ORDERED_OPS,
  boolean: ['is', 'exists', 'missing'],
  // Document content is never compared, only tested for presence.
  document: ['exists', 'missing'],
}

/** The operators a property offers; the first is the default. */
export function opsForDataType(dataType: DataType): readonly FilterOpUi[] {
  return PROPERTY_OPS[dataType]
}

export const RELATION_OPS: readonly RelationFilterOp[] = ['exists', 'missing']

/** What an operator asks for besides its subject. */
export const OP_VALUE: Record<FilterOpUi, 'value' | 'range' | 'boolean' | 'none'> = {
  contains: 'value',
  eq: 'value',
  ne: 'value',
  gte: 'value',
  lte: 'value',
  between: 'range',
  is: 'boolean',
  exists: 'none',
  missing: 'none',
}

const OP_LABELS: Record<FilterOpUi, string> = {
  contains: 'contains',
  eq: 'equals',
  ne: 'does not equal',
  gte: '≥',
  lte: '≤',
  between: 'between',
  is: 'is',
  exists: 'is set',
  missing: 'is not set',
}

const RELATION_OP_LABELS: Record<RelationFilterOp, string> = {
  exists: 'has any',
  missing: 'has none',
}

export function opLabel(subject: FilterSubject, op: FilterOpUi): string {
  if (subject.kind === 'relation' && (op === 'exists' || op === 'missing')) {
    return RELATION_OP_LABELS[op]
  }
  return OP_LABELS[op]
}

type FilterValue = string | number | boolean

function coerce(value: string, dataType: DataType): FilterValue {
  if (dataType === 'integer') {
    const n = Number.parseInt(value, 10)
    return Number.isNaN(n) ? value : n
  }
  if (dataType === 'float') {
    const n = Number.parseFloat(value)
    return Number.isNaN(n) ? value : n
  }
  if (dataType === 'boolean') return value === 'true'
  return value
}

/** The params one condition contributes, from its subject key. */
const SERIALIZE: Record<
  FilterOpUi,
  (key: string, f: FilterCondition, dataType: DataType) => [string, FilterValue][]
> = {
  contains: (key, f) => [[`${key}__contains`, f.value]],
  eq: (key, f, dataType) => [[key, coerce(f.value, dataType)]],
  is: (key, f, dataType) => [[key, coerce(f.value, dataType)]],
  ne: (key, f, dataType) => [[`${key}__ne`, coerce(f.value, dataType)]],
  gte: (key, f, dataType) => [[`${key}__gte`, coerce(f.value, dataType)]],
  lte: (key, f, dataType) => [[`${key}__lte`, coerce(f.value, dataType)]],
  between: (key, f, dataType) => {
    const params: [string, FilterValue][] = [[`${key}__gte`, coerce(f.value, dataType)]]
    if (f.value2 !== undefined && f.value2 !== '') {
      params.push([`${key}__lte`, coerce(f.value2, dataType)])
    }
    return params
  },
  // Existence takes a flag instead of a value; only the `true` forms are sent.
  exists: (key) => [[`${key}__exists`, true]],
  missing: (key) => [[`${key}__missing`, true]],
}

/**
 * Serialize applied conditions into a flat map consumed by `buildQuery`'s
 * `filter` handling: keys are the subject key (equality) or `key__op`.
 */
export function filtersToParam(
  filters: readonly FilterCondition[],
  properties: readonly SchemaProperty[],
): Record<string, FilterValue> | undefined {
  if (filters.length === 0) return undefined
  const byKey = new Map(properties.map((p) => [p.key, p]))
  const out: Record<string, FilterValue> = {}
  for (const f of filters) {
    // A relation subject takes existence operators only, which read no data type.
    const dataType =
      f.subject.kind === 'property'
        ? (byKey.get(f.subject.propertyKey)?.dataType ?? 'string')
        : 'string'
    for (const [key, value] of SERIALIZE[f.op](subjectKey(f.subject), f, dataType)) {
      out[key] = value
    }
  }
  return out
}

/**
 * Apply `next`. A subject holds one condition — the server keeps one value per
 * filter key — so a condition already on the subject is replaced in place.
 */
export function withCondition(
  filters: readonly FilterCondition[],
  next: FilterCondition,
): FilterCondition[] {
  const key = subjectKey(next.subject)
  const index = filters.findIndex((f) => subjectKey(f.subject) === key)
  return index === -1 ? [...filters, next] : filters.map((f, i) => (i === index ? next : f))
}

/** A relation subject's name, e.g. `Supersedes ← Version`. */
export function relationLabel(relation: RelationSubject): string {
  const arrow = relation.direction === 'outgoing' ? '→' : '←'
  return `${relation.relationType.displayName} ${arrow} ${relation.otherType.displayName}`
}

/**
 * Chip text, e.g. `Name contains "ada"`, `Age between 30 and 40`,
 * `Email is not set` or `Supersedes ← Version has none`.
 */
export function filterLabel(f: FilterCondition, subjects: FilterSubjects): string {
  const subject = f.subject
  const op = opLabel(subject, f.op)
  if (subject.kind === 'relation') {
    const key = subjectKey(subject)
    const relation = subjects.relations.find((r) => subjectKey(relationSubject(r)) === key)
    return `${relation !== undefined ? relationLabel(relation) : key} ${op}`
  }
  const propertyKey = subject.propertyKey
  const prop = subjects.properties.find((p) => p.key === propertyKey)
  const name = prop?.displayName ?? propertyKey
  const fmt = (v: string) => {
    if (prop?.dataType === 'date') return humanDate(v)
    if (prop?.dataType === 'datetime') return humanDateTime(v)
    if (prop?.dataType === 'string') return `"${v}"`
    return v
  }
  switch (OP_VALUE[f.op]) {
    case 'none':
      return `${name} ${op}`
    case 'range':
      return `${name} between ${fmt(f.value)} and ${fmt(f.value2 ?? '…')}`
    default:
      return `${name} ${op} ${fmt(f.value)}`
  }
}
