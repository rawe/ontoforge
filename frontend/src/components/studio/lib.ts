/**
 * Non-component helpers for the Studio surface: key validation, dataType
 * coercion, cache invalidation and error helpers.
 */

import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError } from '@/api/http'
import type { DataType, JsonPrimitive } from '@/api/types'

/* ---------------------------------- keys ----------------------------------- */

export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/

export const isValidKey = (key: string) => KEY_PATTERN.test(key)

/** Derive a snake_case key suggestion from a display name. */
export function deriveKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]/, '')
}

/* -------------------------------- data types -------------------------------- */

export const DATA_TYPES: readonly DataType[] = [
  'string',
  'integer',
  'float',
  'boolean',
  'date',
  'datetime',
  'document',
]

/** Hint shown for data types that need explanation beyond their name. */
export const DATA_TYPE_DESCRIPTIONS: Partial<Record<DataType, string>> = {
  document:
    'Large text, interpreted as Markdown. Chunked for semantic search when embeddings are enabled.',
}

/**
 * Coerce a raw input string to the JSON value for a dataType. Empty → null.
 * Unparseable numbers are passed through as strings so the backend reports
 * the proper validation error.
 */
export function coerceTypedValue(dataType: DataType, raw: string): JsonPrimitive {
  const value = raw.trim()
  if (value === '') return null
  switch (dataType) {
    case 'integer': {
      const n = Number(value)
      return Number.isInteger(n) ? n : value
    }
    case 'float': {
      const n = Number(value)
      return Number.isFinite(n) ? n : value
    }
    case 'boolean':
      return value === 'true' ? true : value === 'false' ? false : value
    default:
      return value
  }
}

/* ------------------------------ invalidation -------------------------------- */

/**
 * Invalidate everything the modeling surface can affect: modeling caches,
 * ontology list and all runtime schemas (the lenses re-render downstream).
 */
export function invalidateModeling(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['model'] })
  void queryClient.invalidateQueries({ queryKey: ['ontologies'] })
  void queryClient.invalidateQueries({ queryKey: ['schema'] })
  void queryClient.invalidateQueries({ queryKey: ['agents'] })
  void queryClient.invalidateQueries({ queryKey: ['savedQueries'] })
}

/* --------------------------------- errors ----------------------------------- */

/** Toast an API error with its backend message. */
export function toastError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error))
}

/** True when the error is a 409 CASCADE_REQUIRED conflict. */
export function isCascadeError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === 'CASCADE_REQUIRED'
}
