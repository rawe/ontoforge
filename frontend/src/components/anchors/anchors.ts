/**
 * Pure helpers for the Workbench's Anchors page and the entity detail's anchor
 * hints: the key rule, what a row says about where an anchor points, the
 * confirmation texts, the anchored MCP URL and the Connect panel's Anchor
 * select. No React, no I/O — unit-tested with `node --test`.
 */

import type { Anchor, AnchorView, PathStep } from '../../api/types.ts'
import { mcpUrl } from '../connect/connectSnippet.ts'
import { MCP_SERVERS } from '../connect/mcpServers.ts'
import { formatPath, stepLabel } from '../entity/hierarchy.ts'
import { LENS_RESOURCE_KEY_PATTERN, MAX_KEY_LENGTH } from '../studio/modeling/schemaKeys.ts'

/** What is wrong with a new anchor's key, or null when it is fine. Mirrors the server's rule. */
export function anchorKeyProblem(key: string, existingKeys: readonly string[]): string | null {
  if (key === '') return 'A key is required.'
  if (!LENS_RESOURCE_KEY_PATTERN.test(key)) {
    return 'Lowercase letters, digits, underscores and hyphens only; must start with a letter.'
  }
  if (key.length > MAX_KEY_LENGTH) return `At most ${MAX_KEY_LENGTH} characters.`
  // A PUT on an existing key would re-point it: a new anchor never reuses one.
  if (existingKeys.includes(key)) return `The anchor ${key} already exists.`
  return null
}

/** How many anchors are dangling: the sidebar entry's red count. */
export function danglingCount(anchors: readonly Anchor[]): number {
  return anchors.filter((anchor) => anchor.state === 'dangling').length
}

/** The keys of the anchors pointing at one entity, in list order. */
export function anchorsAt(anchors: readonly Anchor[], typeKey: string, id: string): string[] {
  return anchors
    .filter((anchor) => anchor.entity?.type === typeKey && anchor.entity.id === id)
    .map((anchor) => anchor.key)
}

/** "agent-a", "agent-a and agent-b", "agent-a, agent-b and agent-c". */
function listKeys(keys: readonly string[]): string {
  if (keys.length <= 1) return keys.join('')
  return `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}`
}

/** The entity detail's chip: "agent-a is anchored here". */
export function anchoredHereText(keys: readonly string[]): string {
  return `${listKeys(keys)} ${keys.length === 1 ? 'is' : 'are'} anchored here`
}

/** The entity delete dialog's warning: "agent-a is anchored here and will be dangling". */
export function danglingWarningText(keys: readonly string[]): string {
  return `${anchoredHereText(keys)} and will be dangling`
}

/** Where an anchor points, for its row: a main line, a muted second line, and a tone. */
export interface AnchorPlacement {
  primary: string
  secondary: string | null
  tone: 'path' | 'muted' | 'bad'
}

/**
 * A row's "Anchored at" cell. The state comes from the list; the name and the
 * path from the anchor's view through the lens (undefined while loading).
 * `typeName` names a type by its display name, falling back to its key.
 */
export function anchorPlacement(
  anchor: Anchor,
  view: AnchorView | undefined,
  typeName: (typeKey: string) => string,
): AnchorPlacement {
  if (anchor.state === 'unanchored') {
    return { primary: 'No restriction, like the plain lens', secondary: null, tone: 'muted' }
  }
  if (anchor.state === 'dangling' || view?.state === 'dangling') {
    const what =
      anchor.entity === null
        ? 'The entity'
        : `${typeName(anchor.entity.type)} ${anchor.entity.id.slice(0, 4)}…`
    return { primary: `${what} was deleted`, secondary: 'Every write is refused', tone: 'bad' }
  }
  if (view === undefined) return { primary: '…', secondary: null, tone: 'muted' }
  if (!view.visible || view.entity === null) {
    return {
      primary: 'Hidden by this lens',
      secondary: 'Writes through this lens are refused',
      tone: 'muted',
    }
  }
  return {
    primary: formatPath(view.path),
    secondary: `${typeName(view.entity.type)} · ${stepLabel(view.entity)}`,
    tone: 'path',
  }
}

/** A path for a sentence: "ACME › P1", or a stand-in when the lens shows none of it. */
const pathText = (path: readonly PathStep[]) =>
  path.length === 0 ? 'an entity this lens hides' : formatPath(path)

/**
 * Re-point's question, naming the old and the new path:
 * "Anchor agent-a at ACME › P2? Was ACME › P1. Its next call works under P2."
 */
export function repointConfirmation(
  key: string,
  oldPath: readonly PathStep[],
  newPath: readonly PathStep[],
): string {
  const target = newPath.at(-1)
  const under = target === undefined ? '' : ` Its next call works under ${stepLabel(target)}.`
  return `Anchor ${key} at ${pathText(newPath)}? Was ${pathText(oldPath)}.${under}`
}

/** Unanchor's question: "agent-b will be able to write anywhere in lens work." */
export function unanchorConfirmation(key: string, lensKey: string): string {
  return `${key} will be able to write anywhere in lens ${lensKey}.`
}

/** Delete's question; typing the key enables Delete. */
export const DELETE_CONFIRMATION = 'Clients using this URL get not found.'

/** The anchored runtime MCP URL: the Connect panel's runtime URL under that anchor. */
export function anchoredMcpUrl(
  baseUrl: string | null,
  ontologyKey: string,
  lensKey: string,
  anchorKey: string,
): string {
  const runtime = MCP_SERVERS.find((server) => server.key === 'runtime')!
  return mcpUrl(runtime, { baseUrl, ontologyKey, lensKey, anchorKey })
}

/** An Anchor select option on the Connect panel: "agent-a · ACME › P1". */
export function anchorOptionLabel(anchor: Anchor, view: AnchorView | undefined): string {
  if (anchor.state !== 'anchored' || view?.state === 'dangling') {
    return `${anchor.key} · ${view?.state ?? anchor.state}`
  }
  if (view === undefined) return anchor.key
  if (!view.visible) return `${anchor.key} · hidden by this lens`
  return `${anchor.key} · ${formatPath(view.path)}`
}

/** The Connect card's line under the Anchor select: what the anchored connection may write. */
export function anchorWritesLine(anchor: Anchor, view: AnchorView | undefined): string | null {
  if (anchor.state === 'unanchored') return 'No restriction, like the plain lens.'
  if (anchor.state === 'dangling' || view?.state === 'dangling') {
    return 'Its entity was deleted: every write is refused.'
  }
  if (view === undefined) return null
  if (!view.visible || view.entity === null) {
    return 'This lens hides its entity: every write through it is refused.'
  }
  return `Writes only to ${stepLabel(view.entity)} and its descendants.`
}
