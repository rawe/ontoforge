/**
 * The assistant panel's pure parts: the focus a page publishes, its id,
 * and the panel's remembered open state and width.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */

import { addressId } from '../address.ts'
import type { Focus } from '../types.ts'

/** The schema page's selection: a type by kind and key, and the property opened in it. */
export interface SchemaSelection {
  kind: 'entity-types' | 'relation-types'
  key: string
}

/** What the schema page has in view: the opened property, else the selected type, else nothing. */
export function schemaFocus(selection: SchemaSelection | null, propertyKey: string | null): Focus | null {
  if (selection === null) return null
  if (selection.kind === 'entity-types') {
    return propertyKey === null
      ? { kind: 'entityType', entityType: selection.key }
      : { kind: 'entityTypeProperty', entityType: selection.key, property: propertyKey }
  }
  return propertyKey === null
    ? { kind: 'relationType', relationType: selection.key }
    : { kind: 'relationTypeProperty', relationType: selection.key, property: propertyKey }
}

/** One string per focus, for comparing and as a dependency; null for none. */
export function focusId(focus: Focus | null): string | null {
  return focus === null ? null : addressId(focus)
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
