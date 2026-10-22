/**
 * Pure helpers for the Workbench's Rulesets page, its dialog and the entity
 * detail's anchor hints: the key rule, the write access levels, what a row
 * says about where an anchor points, the patch a save sends, the lines of the
 * loosening confirmation, the ruleset's MCP URL and the Connect panel's
 * select. No React, no I/O — unit-tested with `node --test`.
 */

import type { PathStep, Ruleset, RulesetPatch, RulesetView, WriteAccess } from '../../api/types.ts'
import { mcpUrl } from '../connect/connectSnippet.ts'
import { MCP_SERVERS } from '../connect/mcpServers.ts'
import { formatPath, stepLabel } from '../entity/hierarchy.ts'
import { MAX_KEY_LENGTH, RULESET_KEY_PATTERN } from '../studio/modeling/schemaKeys.ts'

/** What is wrong with a new ruleset's key, or null when it is fine. Mirrors the server's rule. */
export function rulesetKeyProblem(key: string, existingKeys: readonly string[]): string | null {
  if (key === '') return 'A key is required.'
  if (!RULESET_KEY_PATTERN.test(key)) {
    return 'Lowercase letters, digits, underscores and hyphens only; must start with a letter.'
  }
  if (key.length > MAX_KEY_LENGTH) return `At most ${MAX_KEY_LENGTH} characters.`
  // A PUT on an existing key would change its rules: a new ruleset never reuses one.
  if (existingKeys.includes(key)) return `The ruleset ${key} already exists.`
  return null
}

/** One write access level, as the dialog's card, the row's tooltip and the Connect line say it. */
export interface WriteAccessLevel {
  level: WriteAccess
  title: string
  /** The dialog card's text. */
  line: string
  /** One line: the level chip's tooltip and the Connect panel. */
  short: string
}

/** The levels, from read only up to everything: each allows all below it. */
export const WRITE_ACCESS_LEVELS: readonly WriteAccessLevel[] = [
  {
    level: 'none',
    title: 'Read only',
    line: 'Reads the lens. Cannot write, cannot stage changes.',
    short: 'Read only: no writes, no changesets.',
  },
  {
    level: 'propose',
    title: 'Proposes changes',
    line: 'Stages writes into a changeset and submits it. Cannot write at once or commit: a person commits.',
    short: 'Stages writes into a changeset and submits it; a person commits.',
  },
  {
    level: 'full',
    title: 'Writes as the lens allows',
    line: 'Writes at once or through a changeset, and commits.',
    short: 'Writes as the lens allows, at once or through a changeset.',
  },
]

/** A level's texts. */
export function writeAccessLevel(level: WriteAccess): WriteAccessLevel {
  return WRITE_ACCESS_LEVELS.find((l) => l.level === level)!
}

const rank = (level: WriteAccess) => WRITE_ACCESS_LEVELS.findIndex((l) => l.level === level)

/** How many rulesets' anchors are deleted: the sidebar entry's red count. */
export function deletedAnchorCount(rulesets: readonly Ruleset[]): number {
  return rulesets.filter((ruleset) => ruleset.anchor?.state === 'deleted').length
}

/** The keys of the rulesets whose anchor is one entity, in list order. */
export function anchorsAt(rulesets: readonly Ruleset[], typeKey: string, id: string): string[] {
  return rulesets
    .filter((ruleset) => ruleset.anchor?.type === typeKey && ruleset.anchor.id === id)
    .map((ruleset) => ruleset.key)
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

/**
 * Where a ruleset's anchor points, for its row: a main line, a muted second
 * line, and what kind of answer it is (the cell's icon and colour).
 */
export interface AnchorPlacement {
  kind: 'path' | 'none' | 'deleted' | 'hidden' | 'loading'
  primary: string
  secondary: string | null
}

/**
 * A row's Anchor cell. Whether an anchor is set, and its state, come from the
 * list; the name and the path from the ruleset's view through the lens
 * (undefined while loading). `typeName` names a type by its display name,
 * falling back to its key.
 */
export function anchorPlacement(
  ruleset: Ruleset,
  view: RulesetView | undefined,
  typeName: (typeKey: string) => string,
): AnchorPlacement {
  const anchor = ruleset.anchor
  if (anchor === null) return { kind: 'none', primary: 'No anchor', secondary: null }
  if (anchor.state === 'deleted' || view?.anchor?.state === 'deleted') {
    return {
      kind: 'deleted',
      primary: `${typeName(anchor.type)} ${anchor.id.slice(0, 4)}… was deleted`,
      secondary: 'Every write is refused',
    }
  }
  const seen = view?.anchor
  if (seen === undefined || seen === null) return { kind: 'loading', primary: '…', secondary: null }
  if (!seen.visible || seen.type === null || seen.id === null) {
    return {
      kind: 'hidden',
      primary: 'Hidden by this lens',
      secondary: 'Writes through this lens are refused',
    }
  }
  return {
    kind: 'path',
    primary: formatPath(seen.path),
    secondary: `${typeName(seen.type)} · ${stepLabel({ type: seen.type, id: seen.id, name: seen.name })}`,
  }
}

/** The rules a ruleset has, or the dialog chose; `anchor` null: no anchor. */
export interface RuleValues {
  writeAccess: WriteAccess
  anchor: { type: string; id: string } | null
}

/** A new ruleset's rules before the dialog changes them: no anchor, write access full. */
export const DEFAULT_RULES: RuleValues = { writeAccess: 'full', anchor: null }

/** The PUT body of a save: only the rules that differ from `before`. */
export function rulesetPatch(before: RuleValues, after: RuleValues): RulesetPatch {
  const patch: RulesetPatch = {}
  if (after.writeAccess !== before.writeAccess) patch.writeAccess = after.writeAccess
  const same =
    after.anchor === null || before.anchor === null
      ? after.anchor === before.anchor
      : after.anchor.type === before.anchor.type && after.anchor.id === before.anchor.id
  if (!same) patch.anchor = after.anchor
  return patch
}

/** One line of the loosening confirmation: "{rule}: {text}". */
export interface RuleLine {
  rule: string
  text: string
}

/** A path for a sentence: "ACME › P1", or a stand-in when the lens shows none of it. */
const pathText = (path: readonly PathStep[]) =>
  path.length === 0 ? 'an entity this lens hides' : formatPath(path)

/**
 * The rules a save loosens, one line each, in the dialog's order; empty when
 * it only tightens, so it saves at once. Raising write access loosens; so do
 * removing the anchor, moving it out of its subtree, and re-pointing a deleted
 * one (which refused every write); its old path is then the row's deleted
 * text. Setting an anchor or narrowing it into its subtree tightens.
 * `fromPath` is the stored anchor's path through the lens, `toPath` the new
 * one's; `typeName` names a type as `anchorPlacement` does.
 */
export function loosenedRules(
  ruleset: Ruleset,
  patch: RulesetPatch,
  {
    lensKey,
    fromPath,
    toPath,
    typeName,
  }: {
    lensKey: string
    fromPath: readonly PathStep[]
    toPath: readonly PathStep[]
    typeName: (typeKey: string) => string
  },
): RuleLine[] {
  const lines: RuleLine[] = []
  const key = ruleset.key
  if (patch.writeAccess !== undefined && rank(patch.writeAccess) > rank(ruleset.writeAccess)) {
    lines.push({
      rule: 'Write access',
      text:
        patch.writeAccess === 'full'
          ? `raised to full. ${key} will write at once, and it can commit.`
          : `raised to propose. ${key} will be able to stage and submit changesets.`,
    })
  }
  const from = ruleset.anchor
  if (patch.anchor !== undefined && from !== null) {
    if (patch.anchor === null) {
      lines.push({ rule: 'Anchor', text: `removed. ${key} will be able to write anywhere in lens ${lensKey}.` })
    } else if (from.state === 'deleted' || !toPath.some((s) => s.type === from.type && s.id === from.id)) {
      const old =
        from.state === 'deleted' ? anchorPlacement(ruleset, undefined, typeName).primary : pathText(fromPath)
      const target = toPath.at(-1)
      const under = target === undefined ? '' : ` Its next call works under ${stepLabel(target)}.`
      lines.push({ rule: 'Anchor', text: `moves from ${old} to ${pathText(toPath)}.${under}` })
    }
  }
  return lines
}

/** Delete's question; typing the key enables Delete. */
export const DELETE_CONFIRMATION = 'Clients using this URL get not found.'

/** The ruleset's runtime MCP URL: the Connect panel's runtime URL under that ruleset. */
export function rulesetMcpUrl(
  baseUrl: string | null,
  ontologyKey: string,
  lensKey: string,
  rulesetKey: string,
): string {
  const runtime = MCP_SERVERS.find((server) => server.key === 'runtime')!
  return mcpUrl(runtime, { baseUrl, ontologyKey, lensKey, anchorKey: rulesetKey })
}

/** A select option on the Connect panel: "agent-a · ACME › P1". */
export function anchorOptionLabel(ruleset: Ruleset, view: RulesetView | undefined): string {
  if (ruleset.anchor === null) return `${ruleset.key} · no anchor`
  if (ruleset.anchor.state === 'deleted' || view?.anchor?.state === 'deleted') {
    return `${ruleset.key} · deleted`
  }
  if (view?.anchor === undefined || view.anchor === null) return ruleset.key
  if (!view.anchor.visible) return `${ruleset.key} · hidden by this lens`
  return `${ruleset.key} · ${formatPath(view.anchor.path)}`
}

/** The Connect card's line under the select: where the connection may write. */
export function anchorWritesLine(ruleset: Ruleset, view: RulesetView | undefined): string | null {
  if (ruleset.anchor === null) return 'No restriction, like the plain lens.'
  if (ruleset.anchor.state === 'deleted' || view?.anchor?.state === 'deleted') {
    return 'Its entity was deleted: every write is refused.'
  }
  const seen = view?.anchor
  if (seen === undefined || seen === null) return null
  if (!seen.visible || seen.id === null) {
    return 'This lens hides its entity: every write through it is refused.'
  }
  return `Hierarchy writes only under ${stepLabel({ type: seen.type ?? '', id: seen.id, name: seen.name })}; other types are free.`
}
