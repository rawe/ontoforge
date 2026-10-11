/**
 * Quick-create syntax for relation types in the schema command palette —
 * pure, unit-tested with `node --test`:
 *
 *   person -mentors-> intern      person works_on project
 *
 * An endpoint matches an entity type's key or display name
 * (case-insensitive), or the key derived from it; an unknown endpoint is
 * offered as a new entity type with the derived key.
 */

import type { EntityType } from '@/api/types'
import { deriveKey, humanize } from './schemaKeys.ts'

export interface QuickEnd {
  /** As typed. */
  token: string
  /** The existing type's key, or the derived key of a new one. */
  key: string
  existing: EntityType | null
}

export interface QuickRelation {
  source: QuickEnd
  target: QuickEnd
  key: string
  displayName: string
}

const ARROW = /^\s*(\S+)\s+-+\s*([^>]+?)\s*-*>\s*(\S+)\s*$/
const PLAIN = /^\s*(\S+)\s+([a-zA-Z]\w*)\s+(\S+)\s*$/

/** The relation the input describes, or null when it is no quick-create line. */
export function parseQuickRelation(input: string, entityTypes: readonly EntityType[]): QuickRelation | null {
  const m = ARROW.exec(input) ?? PLAIN.exec(input)
  if (m === null) return null
  const [, src = '', name = '', tgt = ''] = m
  const key = deriveKey(name)
  if (key === '') return null
  const resolve = (token: string): QuickEnd => {
    const lower = token.toLowerCase()
    const derived = deriveKey(token)
    const existing =
      entityTypes.find((t) => t.key === lower) ??
      entityTypes.find((t) => t.displayName.toLowerCase() === lower) ??
      entityTypes.find((t) => t.key === derived) ??
      null
    return { token, key: existing?.key ?? derived, existing }
  }
  return { source: resolve(src), target: resolve(tgt), key, displayName: humanize(name) }
}

/** The endpoints to create first: unknown ones, each key once (a self-relation names it twice). */
export function missingEnds(quick: QuickRelation): QuickEnd[] {
  const ends = [quick.source, quick.target].filter((e) => e.existing === null)
  return ends.filter((e, i) => ends.findIndex((x) => x.key === e.key) === i)
}
