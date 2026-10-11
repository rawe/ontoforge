/**
 * What the schema graph remembers per ontology. Positions and collapsed
 * property lists are stored in the browser (`lib/storage.ts`), keyed by
 * entity type id; the viewport is kept in memory for the session only, so
 * switching to the classic view and back returns to the same view.
 *
 * `toggleAll`, `allCollapsedOf` and `prunePositions` are pure (unit-tested
 * with `node --test`); the rest wraps storage.
 */

import { useSyncExternalStore } from 'react'
import type { Viewport } from '@xyflow/react'
import type { SchemaSelection } from '../schema/schemaUrl'
import { readJson, storageKeys, writeJson } from '../../../lib/storage.ts'
import type { Positions } from './layout.ts'

export type Collapsed = Record<string, true>

/* -------------------------------- positions -------------------------------- */

/** Only the positions of `ids`. */
export function prunePositions(positions: Positions, ids: readonly string[]): Positions {
  const out: Positions = {}
  for (const id of ids) if (positions[id] !== undefined) out[id] = positions[id]
  return out
}

export function loadPositions(ontologyKey: string): Positions {
  const raw = readJson<unknown>(storageKeys.schemaPositions(ontologyKey))
  if (raw === null || typeof raw !== 'object') return {}
  const out: Positions = {}
  for (const [id, p] of Object.entries(raw as Record<string, unknown>)) {
    const { x, y } = (p ?? {}) as { x?: unknown; y?: unknown }
    if (typeof x === 'number' && typeof y === 'number') out[id] = { x, y }
  }
  return out
}

/** Stores the positions of the current entity types (`ids`); any other id is dropped. */
export function savePositions(ontologyKey: string, positions: Positions, ids: readonly string[]): void {
  writeJson(storageKeys.schemaPositions(ontologyKey), prunePositions(positions, ids))
}

/* ----------------------------- collapsed lists ----------------------------- */

/** True when every listed node is collapsed (and there is at least one). */
export function allCollapsedOf(state: Collapsed, ids: readonly string[]): boolean {
  return ids.length > 0 && ids.every((id) => state[id] === true)
}

/** Hide or show all: expand every node if all are collapsed, else collapse every node. */
export function toggleAll(state: Collapsed, ids: readonly string[]): Collapsed {
  return allCollapsedOf(state, ids) ? {} : Object.fromEntries(ids.map((id) => [id, true as const]))
}

// One small external store per ontology, so node chevrons, the toolbar and
// the keys share the flags without threading callbacks through node data.
const collapsedByOntology = new Map<string, Collapsed>()
const listeners = new Set<() => void>()

function collapsedOf(ontologyKey: string): Collapsed {
  let state = collapsedByOntology.get(ontologyKey)
  if (state === undefined) {
    const raw = readJson<unknown>(storageKeys.schemaCollapsed(ontologyKey))
    state = {}
    if (raw !== null && typeof raw === 'object') {
      for (const [id, v] of Object.entries(raw as Record<string, unknown>)) if (v === true) state[id] = true
    }
    collapsedByOntology.set(ontologyKey, state)
  }
  return state
}

function setCollapsed(ontologyKey: string, next: Collapsed) {
  collapsedByOntology.set(ontologyKey, next)
  writeJson(storageKeys.schemaCollapsed(ontologyKey), next)
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useCollapsed(ontologyKey: string): Collapsed {
  return useSyncExternalStore(subscribe, () => collapsedOf(ontologyKey))
}

export function toggleCollapsed(ontologyKey: string, id: string): void {
  const next = { ...collapsedOf(ontologyKey) }
  if (next[id] === true) delete next[id]
  else next[id] = true
  setCollapsed(ontologyKey, next)
}

export function toggleAllCollapsed(ontologyKey: string, ids: readonly string[]): void {
  setCollapsed(ontologyKey, toggleAll(collapsedOf(ontologyKey), ids))
}

/* --------------------------------- viewport --------------------------------- */

/** The graph's viewport and selection when it was last left, per ontology. */
export interface KeptView {
  viewport: Viewport
  selection: SchemaSelection | null
}

const keptViews = new Map<string, KeptView>()

export function keptView(ontologyKey: string): KeptView | null {
  return keptViews.get(ontologyKey) ?? null
}

export function keepView(ontologyKey: string, view: KeptView): void {
  keptViews.set(ontologyKey, view)
}
