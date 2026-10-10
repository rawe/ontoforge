/**
 * Addresses of the schema page — pure, unit-tested with `node --test`. The
 * address is the only source of the view and the selection:
 *
 *   /o/{ok}/studio/schema/graph[?sel=entity:{key}|relation:{key}[&prop={key}]]
 *   /o/{ok}/studio/schema/types                                  classic list
 *   /o/{ok}/studio/schema/types/entity/{key}[?prop={key}]        classic type page
 *   /o/{ok}/studio/schema/types/relation/{key}[?prop={key}]
 *
 * `prop` without a selection is ignored, and dropped by the next build.
 */

import type { TypeKind } from '../modeling/useModelSchema'

export type SchemaView = 'graph' | 'classic'

/** The selected type, by key (keys are immutable, so a selection never goes stale). */
export interface SchemaSelection {
  kind: TypeKind
  key: string
}

export interface SchemaUrlState {
  view: SchemaView
  sel: SchemaSelection | null
  /** Key of the opened property of the selected type. */
  prop: string | null
}

const KIND_SEGMENT: Record<TypeKind, string> = {
  'entity-types': 'entity',
  'relation-types': 'relation',
}

function segmentKind(segment: string | undefined): TypeKind | null {
  if (segment === 'entity') return 'entity-types'
  if (segment === 'relation') return 'relation-types'
  return null
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/** Reads view, selection and property from a schema page address. */
export function parseSchemaUrl(pathname: string, search: string): SchemaUrlState {
  // o, {ok}, studio, schema, graph|types, kind?, key?
  const parts = pathname.split('/').filter(Boolean).slice(4)
  const params = new URLSearchParams(search)
  let view: SchemaView = 'graph'
  let sel: SchemaSelection | null = null
  if (parts[0] === 'types') {
    view = 'classic'
    const kind = segmentKind(parts[1])
    const key = parts[2] === undefined ? null : decode(parts[2])
    if (kind !== null && key) sel = { kind, key }
  } else {
    const raw = params.get('sel') ?? ''
    const at = raw.indexOf(':')
    const kind = segmentKind(raw.slice(0, at))
    const key = raw.slice(at + 1)
    if (at > 0 && kind !== null && key) sel = { kind, key }
  }
  const prop = sel === null ? null : params.get('prop') || null
  return { view, sel, prop }
}

/** The address of `view` with `sel` and `prop`. `prop` is dropped without `sel`. */
export function buildSchemaUrl(
  ontologyKey: string,
  view: SchemaView,
  sel: SchemaSelection | null,
  prop: string | null = null,
): string {
  const base = `/o/${ontologyKey}/studio/schema`
  // Built by hand so the address stays readable (`sel=entity:person`).
  const propPart = sel !== null && prop !== null ? `prop=${encodeURIComponent(prop)}` : null
  if (view === 'graph') {
    const query = [
      sel === null ? null : `sel=${KIND_SEGMENT[sel.kind]}:${encodeURIComponent(sel.key)}`,
      propPart,
    ].filter((part) => part !== null)
    return `${base}/graph${query.length > 0 ? `?${query.join('&')}` : ''}`
  }
  if (sel === null) return `${base}/types`
  const path = `${base}/types/${KIND_SEGMENT[sel.kind]}/${encodeURIComponent(sel.key)}`
  return propPart === null ? path : `${path}?${propPart}`
}
