/**
 * Where the Studio ↔ Workbench switch leads — pure, unit-tested with
 * `node --test`. Each surface's address is mapped to its equivalent on the
 * other surface; where none exists, to the nearest one that does.
 *
 *   Workbench                          Studio
 *   /w/{lens}/t/{type} · /e/{type}/…   schema graph with that entity type selected
 *   /w/{lens}/query                    that lens, Saved queries tab
 *   /w/{lens}/ai[?tab=…]               that lens, the matching assistant tab
 *   /w/{lens}/rulesets                 that lens, Connect tab
 *   /w/{lens} · /explore · /changesets that lens, Scope tab
 *
 *   Studio                             Workbench
 *   /lenses/{id}[?tab=…]               that lens, the matching page
 *   schema with entity type selected   that type's table in the target lens,
 *                                      or the lens's Home when it is out of scope
 *   anything else                      the target lens's Home
 */

import type { Lens } from '../../api/types.ts'
import { buildSchemaUrl, parseSchemaUrl } from '../studio/schema/schemaUrl.ts'

/** The Studio address equivalent to a Workbench address. */
export function studioTarget(
  ontologyKey: string,
  pathname: string,
  search: string,
  /** Id of the current lens; until known, lens-level pages fall back to the lens list. */
  lensId: string | undefined,
): string {
  // o, {ok}, w, {lens}, page, …
  const [page, typeKey] = pathname.split('/').filter(Boolean).slice(4)
  if ((page === 't' || page === 'e') && typeKey !== undefined) {
    return buildSchemaUrl(ontologyKey, 'graph', {
      kind: 'entity-types',
      key: decodeURIComponent(typeKey),
    })
  }
  if (lensId === undefined) return `/o/${ontologyKey}/studio/lenses`
  const lens = `/o/${ontologyKey}/studio/lenses/${lensId}`
  if (page === 'query') return `${lens}?tab=queries`
  if (page === 'rulesets') return `${lens}?tab=connect`
  if (page === 'ai') {
    const tab = new URLSearchParams(search).get('tab')
    if (tab === 'retriever') return `${lens}?tab=retriever-agents`
    if (tab === 'navigator') return `${lens}?tab=navigators`
    return `${lens}?tab=agents`
  }
  return lens
}

/** What a Studio address asks of the Workbench. */
export type StudioContext =
  | { kind: 'lens'; lensId: string; tab: string | null }
  | { kind: 'type'; typeKey: string }
  | { kind: 'none' }

export function studioContext(pathname: string, search: string): StudioContext {
  // o, {ok}, studio, section, …
  const [section, id] = pathname.split('/').filter(Boolean).slice(3)
  if (section === 'lenses' && id !== undefined) {
    return { kind: 'lens', lensId: id, tab: new URLSearchParams(search).get('tab') }
  }
  if (section === 'schema') {
    const { sel } = parseSchemaUrl(pathname, search)
    if (sel?.kind === 'entity-types') return { kind: 'type', typeKey: sel.key }
  }
  return { kind: 'none' }
}

/** The Workbench page of a lens that matches a Studio lens tab. */
export function workbenchLensPage(ontologyKey: string, lensKey: string, tab: string | null): string {
  const base = `/o/${ontologyKey}/w/${lensKey}`
  if (tab === 'queries') return `${base}/query?tab=library`
  if (tab === 'agents') return `${base}/ai`
  if (tab === 'retriever-agents') return `${base}/ai?tab=retriever`
  if (tab === 'navigators') return `${base}/ai?tab=navigator`
  return base
}

/**
 * The lens the Workbench opens when the address names none: the remembered
 * one if it still exists, else the first unscoped lens, else the first lens.
 */
export function pickLens(
  lenses: readonly Lens[],
  remembered: string | null,
  /** Keys of the lenses known to be unscoped. */
  unscoped: ReadonlySet<string>,
): Lens | null {
  return (
    lenses.find((l) => l.key === remembered) ??
    lenses.find((l) => unscoped.has(l.key)) ??
    lenses[0] ??
    null
  )
}
