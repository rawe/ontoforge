/**
 * Filter model for the type tables. A `FilterCondition` is one applied chip;
 * ops are constrained per dataType. Conditions serialize to the runtime list
 * endpoint's `filter.{key}` / `filter.{key}__{op}` params — "between" expands
 * into a `__gte` + `__lte` pair on the same property.
 */

import type { DataType, SchemaProperty } from '@/api/types'
import { humanDate, humanDateTime } from './format'

export type FilterOpUi = 'contains' | 'eq' | 'gte' | 'lte' | 'between' | 'is'

export interface FilterCondition {
  /** Local unique id for chip removal. */
  id: string
  propertyKey: string
  op: FilterOpUi
  value: string
  /** Upper bound, only for `between`. */
  value2?: string
}

export function opsForDataType(dataType: DataType): FilterOpUi[] {
  switch (dataType) {
    case 'string':
      return ['contains', 'eq']
    case 'integer':
    case 'float':
    case 'date':
    case 'datetime':
      return ['eq', 'gte', 'lte', 'between']
    case 'boolean':
      return ['is']
    // Documents are stubbed in reads and not filterable from the table.
    case 'document':
      return []
  }
}

export const OP_LABELS: Record<FilterOpUi, string> = {
  contains: 'contains',
  eq: 'equals',
  gte: '≥',
  lte: '≤',
  between: 'between',
  is: 'is',
}

function coerce(value: string, dataType: DataType): string | number | boolean {
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

/**
 * Serialize applied conditions into a flat map consumed by `buildQuery`'s
 * `filter` handling: keys are `prop` (equality) or `prop__op`, values bare.
 */
export function filtersToParam(
  filters: readonly FilterCondition[],
  properties: readonly SchemaProperty[],
): Record<string, string | number | boolean> | undefined {
  if (filters.length === 0) return undefined
  const byKey = new Map(properties.map((p) => [p.key, p]))
  const out: Record<string, string | number | boolean> = {}
  for (const f of filters) {
    const dataType = byKey.get(f.propertyKey)?.dataType ?? 'string'
    switch (f.op) {
      case 'contains':
        out[`${f.propertyKey}__contains`] = f.value
        break
      case 'eq':
      case 'is':
        out[f.propertyKey] = coerce(f.value, dataType)
        break
      case 'gte':
      case 'lte':
        out[`${f.propertyKey}__${f.op}`] = coerce(f.value, dataType)
        break
      case 'between':
        out[`${f.propertyKey}__gte`] = coerce(f.value, dataType)
        if (f.value2 !== undefined && f.value2 !== '') {
          out[`${f.propertyKey}__lte`] = coerce(f.value2, dataType)
        }
        break
    }
  }
  return out
}

/** Chip text, e.g. `Name contains "ada"` or `Age between 30 and 40`. */
export function filterLabel(
  f: FilterCondition,
  properties: readonly SchemaProperty[],
): string {
  const prop = properties.find((p) => p.key === f.propertyKey)
  const name = prop?.displayName ?? f.propertyKey
  const fmt = (v: string) => {
    if (prop?.dataType === 'date') return humanDate(v)
    if (prop?.dataType === 'datetime') return humanDateTime(v)
    if (prop?.dataType === 'string') return `"${v}"`
    return v
  }
  if (f.op === 'between') {
    return `${name} between ${fmt(f.value)} and ${fmt(f.value2 ?? '…')}`
  }
  return `${name} ${OP_LABELS[f.op]} ${fmt(f.value)}`
}
