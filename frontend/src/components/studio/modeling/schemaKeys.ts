/**
 * Pure helpers for schema-level keys and data types: the key rule, key
 * suggestions from display names, and which data types a type kind allows.
 * No React, no I/O — unit-tested with `node --test`. `../lib.ts` re-exports
 * the shared ones under their old import path.
 */

import type { DataType } from '@/api/types'
import type { TypeKind } from './useModelSchema'

/**
 * Key rule of the schema level — ontologies, entity and relation types,
 * properties, lenses, search indices: lower snake case, starting with a
 * letter. No hyphen, because these keys appear as OQL identifiers (`-` reads
 * as minus) and in storage names. Mirrors the server's `SCHEMA_KEY_PATTERN`.
 */
export const SCHEMA_KEY_PATTERN = /^[a-z][a-z0-9_]*$/

/**
 * Key rule of the lens-resource level — saved queries, assistants of every
 * kind, anchors: the schema rule plus `-`. These keys travel only in URLs,
 * JSON and tool arguments, never into OQL or storage names, so a hyphen is
 * harmless. Mirrors the server's `LENS_RESOURCE_KEY_PATTERN`.
 */
export const LENS_RESOURCE_KEY_PATTERN = /^[a-z][a-z0-9_-]*$/

/** Mirrors the server's `MAX_KEY_LENGTH`. */
export const MAX_KEY_LENGTH = 64

/**
 * Derive a snake_case key suggestion from a display name: lower-cased,
 * non-alphanumerics collapsed to underscores, every leading digit and
 * underscore dropped, at most `MAX_KEY_LENGTH` characters.
 */
export function deriveKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[0-9_]+/, '')
    .slice(0, MAX_KEY_LENGTH)
    .replace(/_+$/, '')
}

/** What is wrong with a schema key, or null when it is fine. */
export function keyProblem(key: string): string | null {
  if (key === '') return 'A key is required.'
  if (!SCHEMA_KEY_PATTERN.test(key)) {
    return 'Lowercase letters, digits and underscores only; must start with a letter.'
  }
  if (key.length > MAX_KEY_LENGTH) return `At most ${MAX_KEY_LENGTH} characters.`
  return null
}

/** `keyProblem` plus uniqueness against the keys already taken. */
export function keyProblemAmong(key: string, taken: readonly string[]): string | null {
  return keyProblem(key) ?? (taken.includes(key) ? `"${key}" already exists.` : null)
}

/** "works_on" → "Works On". */
export function humanize(text: string): string {
  return text
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export const DATA_TYPES: readonly DataType[] = [
  'string',
  'integer',
  'float',
  'boolean',
  'date',
  'datetime',
  'document',
]

/** `document` properties exist on entity types only (the server rejects them on relation types). */
export function dataTypesFor(kind: TypeKind): readonly DataType[] {
  return kind === 'relation-types' ? DATA_TYPES.filter((t) => t !== 'document') : DATA_TYPES
}

/** A display name with its key, which follows the name until the user edits it. */
export interface NameKey {
  name: string
  key: string
  keyTouched: boolean
}

export const EMPTY_NAME_KEY: NameKey = { name: '', key: '', keyTouched: false }

/** The next state after typing a display name: the key follows unless edited. */
export function withName(value: NameKey, name: string): NameKey {
  return { ...value, name, key: value.keyTouched ? value.key : deriveKey(name) }
}

/** Valid when there is a display name and a well-formed key. */
export function nameKeyValid(value: NameKey): boolean {
  return value.name.trim() !== '' && keyProblem(value.key) === null
}
