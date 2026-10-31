/**
 * The assistant panel's pure parts: the focus a page publishes, how its
 * chip names it, and the panel's remembered open state and width.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */

import type { Focus } from '../types.ts'

/** The schema page's selection: a type by kind and key, and the property opened in it. */
export interface SchemaSelection {
  kind: 'entity-types' | 'relation-types'
  key: string
}

/** What the schema page has in view: the opened property, else the selected type, else nothing. */
export function schemaFocus(selection: SchemaSelection | null, propertyKey: string | null): Focus | null {
  if (selection === null) return null
  if (propertyKey !== null) return { kind: 'property', key: propertyKey, typeKey: selection.key }
  return { kind: selection.kind === 'entity-types' ? 'entityType' : 'relationType', key: selection.key }
}

/** One string per focus, for comparing and as a dependency; null for none. */
export function focusId(focus: Focus | null): string | null {
  if (focus === null) return null
  return JSON.stringify([focus.kind, focus.key, focus.typeKey ?? null, focus.lensKey ?? null])
}

/** The focus an id of `focusId` stands for. */
export function focusFromId(id: string): Focus {
  const [kind, key, typeKey, lensKey] = JSON.parse(id) as [Focus['kind'], string, string | null, string | null]
  return { kind, key, ...(typeKey === null ? {} : { typeKey }), ...(lensKey === null ? {} : { lensKey }) }
}

const WHAT: Record<Focus['kind'], string> = {
  entityType: 'entity type',
  relationType: 'relation type',
  property: 'property',
  lens: 'lens',
  agent: 'agent',
}

/** The chip's text: the item by key (a property with its type) and what it is. */
export function focusLabel(focus: Focus): { name: string; what: string } {
  const owner = focus.kind === 'property' ? focus.typeKey : focus.kind === 'agent' ? focus.lensKey : undefined
  return { name: owner === undefined ? focus.key : `${owner}.${focus.key}`, what: WHAT[focus.kind] }
}

export const MIN_WIDTH = 320
export const MAX_WIDTH = 720
export const DEFAULT_WIDTH = 400
/** The panel's width at least while a proposal review is open, so the review can be read. */
export const REVIEW_WIDTH = 640

/** What the browser remembers of the panel. */
export interface PanelSettings {
  open: boolean
  width: number
}

export const clampWidth = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)))

/** The remembered settings, any malformed part replaced by its default (closed, default width). */
export function panelSettings(stored: unknown): PanelSettings {
  const value = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}
  return {
    open: value.open === true,
    width: typeof value.width === 'number' && Number.isFinite(value.width) ? clampWidth(value.width) : DEFAULT_WIDTH,
  }
}
