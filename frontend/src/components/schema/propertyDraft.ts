/**
 * Draft-string model for schema-driven property inputs.
 *
 * Form state keeps every property value as a string draft ("true"/"false" for
 * booleans); coercion to the wire type happens on submit so partial input
 * never crashes and error messages are collected per field.
 */

import type { DataType, JsonPrimitive, JsonValue, SchemaProperty } from '@/api/types'
import { formatDocSize, isDocumentStub } from '@/lib/documents'

/** String props that read better as a textarea (parity with legacy heuristic). */
export function isLongText(property: SchemaProperty): boolean {
  return (
    property.dataType === 'string' &&
    /(description|bio|summary|notes?|text|comment|body|content|prompt)/i.test(property.key)
  )
}

/** Existing wire value → input draft (per input control expectations). */
export function valueToDraft(dataType: DataType, value: JsonValue | undefined): string {
  if (value === undefined || value === null) return ''
  // Document stubs (and any other object) carry no editable text — the full
  // content must be fetched via the document endpoint.
  if (typeof value === 'object') return ''
  switch (dataType) {
    case 'boolean':
      return value === true ? 'true' : 'false'
    case 'date':
      return String(value).slice(0, 10)
    case 'datetime':
      // datetime-local inputs want "YYYY-MM-DDTHH:mm"
      return String(value).slice(0, 16)
    default:
      return String(value)
  }
}

export type CoercionResult =
  | { ok: true; value: JsonPrimitive | null }
  | { ok: false; error: string }

/** Draft → wire value. An empty draft coerces to `null` (= unset/clear). */
export function coerceDraft(dataType: DataType, draft: string): CoercionResult {
  const trimmed = draft.trim()
  if (trimmed === '') return { ok: true, value: null }
  switch (dataType) {
    case 'integer': {
      if (!/^-?\d+$/.test(trimmed)) return { ok: false, error: 'Expected an integer' }
      return { ok: true, value: Number.parseInt(trimmed, 10) }
    }
    case 'float': {
      const n = Number(trimmed)
      if (!Number.isFinite(n)) return { ok: false, error: 'Expected a number' }
      return { ok: true, value: n }
    }
    case 'boolean':
      return { ok: true, value: trimmed === 'true' }
    default:
      return { ok: true, value: draft }
  }
}

export interface DraftsCoercion {
  ok: boolean
  /** Coerced values; empty optionals are skipped entirely. */
  values: Record<string, JsonValue>
  errors: Record<string, string>
}

/**
 * Coerce a whole draft map against a property list (create-style forms).
 * Empty drafts are skipped; a required property without a schema default
 * errors client-side when left empty.
 */
export function coerceDrafts(
  properties: readonly SchemaProperty[],
  drafts: Record<string, string>,
): DraftsCoercion {
  const values: Record<string, JsonValue> = {}
  const errors: Record<string, string> = {}
  for (const property of properties) {
    const result = coerceDraft(property.dataType, drafts[property.key] ?? '')
    if (!result.ok) {
      errors[property.key] = result.error
      continue
    }
    if (result.value === null) {
      if (property.required && property.defaultValue === null) {
        errors[property.key] = 'Required'
      }
      continue
    }
    values[property.key] = result.value
  }
  return { ok: Object.keys(errors).length === 0, values, errors }
}

/** Human-readable rendering of a wire value for read-only display. */
export function formatValue(dataType: DataType, value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null
  // Document properties arrive as stubs — render the size, never the object.
  if (isDocumentStub(value)) return formatDocSize(value.length)
  if (typeof value === 'object') return JSON.stringify(value)
  switch (dataType) {
    case 'boolean':
      return value === true ? 'true' : 'false'
    case 'datetime': {
      const date = new Date(String(value))
      return Number.isNaN(date.getTime())
        ? String(value)
        : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    }
    default:
      return String(value)
  }
}
