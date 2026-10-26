/**
 * Pure helpers for the Workbench's Changesets page: the list order and the
 * sidebar count, what a list row and a staged object's card say, the
 * violations of a rejected commit and the note built from them, how the
 * bar names the pinned changeset, why the Explorer canvas does not edit
 * while one is pinned, and the values of an entity a changeset creates. No
 * React, no I/O — unit-tested with `node --test`.
 */

import type {
  ChangesetEnd,
  ChangesetListItem,
  ChangesetState,
  ChangesetViolation,
  JsonValue,
  StagedObjectView,
  StagedValueView,
} from '../../api/types.ts'

/** The longest note the server stores, in characters. */
export const MAX_NOTE_LENGTH = 1000

/** Staged objects per page of the review read: the API's default. */
export const OBJECTS_PAGE_SIZE = 100

/** Why the Explorer canvas's connect and edge delete are off while a changeset is pinned. */
export const EXPLORER_LIVE_ONLY_TEXT = 'Explorer edits are live only — leave the changeset to edit here'

/** The state chip's text. */
export function stateLabel(state: ChangesetState): string {
  return state === 'submitted' ? 'submitted' : 'draft'
}

/** The sidebar entry's count: changesets waiting for review. */
export function submittedCount(items: readonly ChangesetListItem[]): number {
  return items.filter((item) => item.state === 'submitted').length
}

/** "create_entity" → "create entity". */
export function operationLabel(operation: string): string {
  return operation.replace('_', ' ')
}

/** A staged object's operation, as the list counts it: "update_entity". */
export function objectOperation(object: Pick<StagedObjectView, 'action' | 'kind'>): string {
  return `${object.action}_${object.kind}`
}

const VERBS = ['create', 'update', 'delete'] as const

/** The staged objects per action, entity and relation together: "create 7 · delete 8". */
export function operationsSummary(operations: Readonly<Record<string, number>>): string {
  return VERBS.map((verb) => {
    const count = Object.entries(operations)
      .filter(([operation]) => operation.startsWith(`${verb}_`))
      .reduce((sum, [, n]) => sum + n, 0)
    return count > 0 ? `${verb} ${count}` : null
  })
    .filter((part) => part !== null)
    .join(' · ')
}

/** "5 staged objects", "1 staged object". */
export function objectsText(count: number): string {
  return `${count.toLocaleString('en-US')} staged ${count === 1 ? 'object' : 'objects'}`
}

/** The lens-delete toast: "Lens deleted", "Lens deleted with 2 changesets". */
export function lensDeletedText(changesetsDeleted: number): string {
  if (changesetsDeleted === 0) return 'Lens deleted'
  return `Lens deleted with ${changesetsDeleted} ${changesetsDeleted === 1 ? 'changeset' : 'changesets'}`
}

/**
 * A list row's types: at most two names, then "+N"; type keys the lens no
 * longer shows are only counted. "Project, Task, +1", "Task, 1 not visible".
 */
export function typesText(
  types: readonly string[],
  notVisible: number,
  typeName: (typeKey: string) => string,
): string {
  const parts = types.slice(0, 2).map(typeName)
  if (types.length > 2) parts.push(`+${types.length - 2}`)
  if (notVisible > 0) parts.push(`${notVisible} not visible`)
  return parts.length === 0 ? '—' : parts.join(', ')
}

/** An id for a sentence when no name is shown: "7f3a9c00…". */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

/** A changeset named in a sentence: "#12 · its note", else its note or short id while its number is unknown. */
export function changesetLabel(changeset: { id: string; number?: number; note: string | null }): string {
  if (changeset.number === undefined) return changeset.note ?? shortId(changeset.id)
  return changeset.note === null ? `#${changeset.number}` : `#${changeset.number} · ${changeset.note}`
}

/** Whether a review value is a document stub `{document: true, length}`. */
function isDocumentStub(value: JsonValue | undefined): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value.document === true
}

/** A stored or staged value, as a staged object's card shows it. */
export function valueText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return 'empty'
  if (typeof value === 'string') return `"${value}"`
  if (isDocumentStub(value)) {
    // The review read stubs document values, as the entity reads do; a
    // before recorded without a length has none.
    const length = (value as Record<string, JsonValue>).length
    return typeof length === 'number' ? `document (${length} characters)` : 'document'
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/**
 * The document properties a staged entity create or update sets, in the
 * order of its values: each can be read as staged text. A staged null
 * removes the text and has nothing to read.
 */
export function stagedDocumentKeys(object: StagedObjectView): string[] {
  if (object.type === null || object.kind !== 'entity' || object.action === 'delete') return []
  return object.values.filter((value) => isDocumentStub(value.after)).map((value) => value.property)
}

/** The values of an entity this changeset creates; null for any other object. */
export function stagedCreateValues(object: StagedObjectView): Record<string, JsonValue> | null {
  if (object.action !== 'create' || object.kind !== 'entity' || object.type === null) return null
  return Object.fromEntries(object.values.map((value) => [value.property, value.after]))
}

/** Beside a staged create while its changeset is not the pinned one. */
export const EXTEND_HINT_TEXT = 'Work in this changeset to extend it'

/** Why a write onto an entity only a changeset creates was refused: that changeset is not pinned. */
export const STAGED_ONLY_TEXT =
  'It exists only in its changeset — work in that changeset to extend it. Nothing was written.'

const endText = (end: ChangesetEnd | undefined) => (end === undefined ? '?' : (end.name ?? shortId(end.id)))

/** What a staged object is: an entity's name, "(new)" for a create, a relation's two ends. */
export function targetText(object: StagedObjectView): string {
  if (object.type === null) return '—'
  if (object.kind === 'relation') return `${endText(object.from)} → ${endText(object.to)}`
  const name = object.name ?? shortId(object.id)
  return object.action === 'create' ? `${name} (new)` : name
}

/** The identity a staged entity gets: "A~1 → B~1" on a rename, the new one
 * alone on a create or a first identity; null when it keeps its identity. */
export function identityChangeText(object: StagedObjectView): string | null {
  if (object.identity === undefined) return null
  const { before, after } = object.identity
  return before === null ? after : `${before} → ${after}`
}

/** Whether a staged value's stored value changed since its before was recorded. */
export function hasDrift(value: StagedValueView): boolean {
  return value.markers.some((marker) => marker.kind === 'drift')
}

/**
 * One staged value's change: `before → after` on an update, with the
 * current stored value where it drifted; the staged value alone on a create.
 */
export function valueChangeText(object: StagedObjectView, value: StagedValueView): string {
  if (object.action !== 'update') return valueText(value.after)
  const change = `${valueText(value.before)} → ${valueText(value.after)}`
  return hasDrift(value) && JSON.stringify(value.current) !== JSON.stringify(value.before)
    ? `${change} (now ${valueText(value.current)})`
    : change
}

/** A marker chip's text. */
export function markerLabel(kind: string): string {
  if (kind === 'not_visible') return 'not visible'
  if (kind === 'replay') return 'invalid value'
  return kind.replaceAll('_', ' ')
}

/** The violations of a rejected commit (a 422's `details`), or null when it carries none. */
export function violationsOf(
  details: Readonly<Record<string, unknown>> | undefined,
): { violations: ChangesetViolation[]; total: number } | null {
  const violations = details?.violations
  if (!Array.isArray(violations) || violations.length === 0) return null
  const total = typeof details?.total === 'number' ? details.total : violations.length
  return { violations: violations as ChangesetViolation[], total }
}

/** The ruleset kinds, as the panel names them for people; an agent reads the raw kind. */
const VIOLATION_LABELS: Readonly<Record<string, string>> = {
  ruleset_gone: 'Ruleset deleted',
  outside_subtree: "Outside the anchor's subtree",
  anchor_deleted: 'Anchor deleted',
  anchor_hidden: 'Anchor hidden by the lens',
  deletes_anchor: "Deletes a ruleset's anchor",
}

/** A violation kind's label on the panel, or null for a kind shown as it is. */
export function violationLabel(kind: string): string | null {
  return VIOLATION_LABELS[kind] ?? null
}

/**
 * Where a violation's line starts: the staged object among `objects` (the
 * page shown) as its card names it, and the property: "P2 Live · name: ".
 * An object not on the page, or not visible, goes unnamed; a violation of
 * the whole changeset starts with nothing.
 */
export function violationPrefix(violation: ChangesetViolation, objects: readonly StagedObjectView[] = []): string {
  if (violation.object === null) return ''
  const object = objects.find((candidate) => candidate.id === violation.object)
  const name = object === undefined ? '—' : targetText(object)
  const parts = [...(name === '—' ? [] : [name]), ...(violation.property === undefined ? [] : [violation.property])]
  return parts.length === 0 ? '' : `${parts.join(' · ')}: `
}

/**
 * One violation for the note, with its raw kind:
 * "P2 Live · name: drift — Changed since it was staged". The panel shows
 * the same line with `violationLabel` in place of a ruleset kind.
 */
export function violationLine(violation: ChangesetViolation, objects: readonly StagedObjectView[] = []): string {
  return `${violationPrefix(violation, objects)}${violation.kind} — ${violation.message}`
}

/**
 * The note "Unsubmit with these violations" sends: a header with the total,
 * then one line per violation with its raw kind, cut to the note's limit.
 */
export function violationsNote(
  violations: readonly ChangesetViolation[],
  total: number,
  objects: readonly StagedObjectView[] = [],
): string {
  const header = `Commit rejected: ${total} ${total === 1 ? 'violation' : 'violations'}`
  const lines = [header, ...violations.map((violation) => violationLine(violation, objects))]
  if (total > violations.length) lines.push(`… and ${total - violations.length} more`)
  const note = lines.join('\n')
  return note.length <= MAX_NOTE_LENGTH ? note : `${note.slice(0, MAX_NOTE_LENGTH - 1)}…`
}

/** A commit's 409 for a version other than the one shown. */
export function isVersionMismatch(error: { status: number; message: string }): boolean {
  return error.status === 409 && error.message.includes('changed since you looked')
}

/** The cached runtime data a commit can change: entities, relations, paths, documents, rulesets. */
const DATA_KEYS = new Set([
  'entities',
  'entity',
  'path',
  'document',
  'neighbors',
  'neighborCounts',
  'relations',
  'rulesets',
  'palette',
])

/** Whether a query holds runtime data of this ontology that a commit can change. */
export function isCommittedDataKey(queryKey: readonly unknown[], ontologyKey: string): boolean {
  const [head, second, third] = queryKey
  if (typeof head !== 'string' || !DATA_KEYS.has(head)) return false
  // The palette's keys carry the ontology one place later: ['palette', kind, ontologyKey, …].
  return (head === 'palette' ? third : second) === ontologyKey
}
