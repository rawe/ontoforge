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
export function rulesetsAnchoredAt(rulesets: readonly Ruleset[], typeKey: string, id: string): string[] {
  return rulesets
    .filter((ruleset) => ruleset.anchor?.type === typeKey && ruleset.anchor.id === id)
    .map((ruleset) => ruleset.key)
}

/** "agent-a", "agent-a and agent-b", "agent-a, agent-b and agent-c". */
function listKeys(keys: readonly string[]): string {
  if (keys.length <= 1) return keys.join('')
  return `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}`
}

/** The entity detail's chip: "Anchor of agent-a". */
export function anchorOfText(keys: readonly string[]): string {
  return `Anchor of ${listKeys(keys)}`
}

/** The entity delete dialog's warning: what a delete does to the rulesets whose anchor it is. */
export function anchorDeleteWarning(keys: readonly string[]): string {
  return keys.length === 1
    ? `This is the anchor of ${keys[0]}: its writes will be refused until the anchor is moved or removed.`
    : `This is the anchor of ${listKeys(keys)}: their writes will be refused until their anchors are moved or removed.`
}

/**
 * A ruleset's anchor as its view through the lens shows it: none, deleted,
 * hidden by the lens, still loading (undefined view), or found with its
 * entity and path.
 */
type AnchorOnLens =
  | { state: 'none' | 'deleted' | 'hidden' | 'loading' }
  | { state: 'found'; entity: PathStep; path: readonly PathStep[] }

function anchorOnLens(ruleset: Ruleset, view: RulesetView | undefined): AnchorOnLens {
  const anchor = ruleset.anchor
  if (anchor === null) return { state: 'none' }
  if (anchor.state === 'deleted' || view?.anchor?.state === 'deleted') return { state: 'deleted' }
  const seen = view?.anchor
  if (seen === undefined || seen === null) return { state: 'loading' }
  if (!seen.visible || seen.type === null || seen.id === null) return { state: 'hidden' }
  return { state: 'found', entity: { type: seen.type, id: seen.id, name: seen.name }, path: seen.path }
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
  const on = anchorOnLens(ruleset, view)
  switch (on.state) {
    case 'none':
      return { kind: 'none', primary: 'No anchor', secondary: null }
    case 'deleted': {
      const anchor = ruleset.anchor!
      return {
        kind: 'deleted',
        primary: `${typeName(anchor.type)} ${anchor.id.slice(0, 4)}… was deleted`,
        secondary: 'Every write is refused',
      }
    }
    case 'loading':
      return { kind: 'loading', primary: '…', secondary: null }
    case 'hidden':
      return {
        kind: 'hidden',
        primary: 'Hidden by this lens',
        secondary: 'Writes through this lens are refused',
      }
    case 'found':
      return {
        kind: 'path',
        primary: formatPath(on.path),
        secondary: `${typeName(on.entity.type)} · ${stepLabel(on.entity)}`,
      }
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
  return mcpUrl(runtime, { baseUrl, ontologyKey, lensKey, rulesetKey })
}

/** A Connect select option: "agent-a · propose · anchor Apollo"; write access first. */
export function rulesetOptionLabel(ruleset: Ruleset, view: RulesetView | undefined): string {
  const label = `${ruleset.key} · ${ruleset.writeAccess}`
  const on = anchorOnLens(ruleset, view)
  switch (on.state) {
    case 'found':
      return `${label} · anchor ${stepLabel(on.entity)}`
    case 'deleted':
    case 'hidden':
      return `${label} · anchor ${on.state}`
    default:
      return label
  }
}

/**
 * One line under the Connect select, per rule: write access with its level,
 * the anchor with its state (the line's icon and colour).
 */
export type RulesetRuleLine =
  | { rule: 'writeAccess'; level: WriteAccess; text: string }
  | { rule: 'anchor'; state: 'found' | 'none' | 'deleted' | 'hidden'; text: string }

/** What a connection through the ruleset may do: write access always, the anchor once its view is read. */
export function rulesetRuleLines(ruleset: Ruleset, view: RulesetView | undefined): RulesetRuleLine[] {
  const { level, short } = writeAccessLevel(ruleset.writeAccess)
  const lines: RulesetRuleLine[] = [
    { rule: 'writeAccess', level, text: `Write access ${level}: ${short[0].toLowerCase()}${short.slice(1)}` },
  ]
  const on = anchorOnLens(ruleset, view)
  if (on.state === 'found') {
    lines.push({
      rule: 'anchor',
      state: 'found',
      text: `Anchor: writes in its hierarchy stay under ${stepLabel(on.entity)}; other types are free.`,
    })
  } else if (on.state === 'none') {
    lines.push({ rule: 'anchor', state: 'none', text: 'No anchor: no limit on where.' })
  } else if (on.state === 'deleted') {
    lines.push({ rule: 'anchor', state: 'deleted', text: 'Anchor deleted: every write is refused.' })
  } else if (on.state === 'hidden') {
    lines.push({
      rule: 'anchor',
      state: 'hidden',
      text: 'Anchor hidden by this lens: every write through it is refused.',
    })
  }
  return lines
}
