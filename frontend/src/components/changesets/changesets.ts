/**
 * Pure helpers for the Workbench's Changesets page: the list order and the
 * sidebar count, what a list row and a staged write's row say, the
 * violations of a rejected commit and the note built from them. No React,
 * no I/O — unit-tested with `node --test`.
 */

import type {
  ChangesetEnd,
  ChangesetListItem,
  ChangesetState,
  ChangesetViolation,
  JsonValue,
  StagedWriteView,
} from '../../api/types.ts'

/** The longest note the server stores, in characters. */
export const MAX_NOTE_LENGTH = 1000

/** Writes per page of the review read: the API's default. */
export const WRITES_PAGE_SIZE = 100

/** The state chip's text. */
export function stateLabel(state: ChangesetState): string {
  return state === 'submitted' ? 'submitted' : 'draft'
}

/** Submitted first (waiting for review), then the most recently changed. */
export function sortChangesets(items: readonly ChangesetListItem[]): ChangesetListItem[] {
  return [...items].sort((a, b) => {
    if (a.state !== b.state) return a.state === 'submitted' ? -1 : 1
    return Date.parse(b.lastChangeAt) - Date.parse(a.lastChangeAt)
  })
}

/** The sidebar entry's count: changesets waiting for review. */
export function submittedCount(items: readonly ChangesetListItem[]): number {
  return items.filter((item) => item.state === 'submitted').length
}

/** "create_entity" → "create entity". */
export function operationLabel(operation: string): string {
  return operation.replace('_', ' ')
}

const VERBS = ['create', 'update', 'delete'] as const

/** The writes per verb, entity and relation together: "create 7 · delete 8". */
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

/** "5 writes", "1 write". */
export function writesText(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'write' : 'writes'}`
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

/** Whether a review value is a document stub `{document: true, length}`. */
function isDocumentStub(value: JsonValue | undefined): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value.document === true
}

/** A stored or staged value, as the change column shows it. */
export function valueText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return 'empty'
  if (typeof value === 'string') return `"${value}"`
  if (isDocumentStub(value)) {
    // The review read stubs document values, as the entity reads do; a
    // write staged without a recorded length has none.
    const length = (value as Record<string, JsonValue>).length
    return typeof length === 'number' ? `document (${length} characters)` : 'document'
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/**
 * The document properties a create or update of an entity sets, in the
 * order it sends them: each can be read as staged text. A staged null
 * removes the text and has nothing to read, and neither has an entity a
 * later write of `writes` (the page shown) deletes: a commit leaves no text.
 */
export function stagedDocumentKeys(write: StagedWriteView, writes: readonly StagedWriteView[] = []): string[] {
  if (write.type === null || write.id === null) return []
  if (write.operation !== 'create_entity' && write.operation !== 'update_entity') return []
  const deletedLater = writes.some(
    (other) =>
      other.seq > write.seq && other.operation === 'delete_entity' && other.type === write.type && other.id === write.id,
  )
  if (deletedLater) return []
  return Object.entries(write.after ?? {})
    .filter(([, value]) => isDocumentStub(value))
    .map(([key]) => key)
}

const valuesText = (values: Readonly<Record<string, JsonValue>>) =>
  Object.entries(values)
    .map(([key, value]) => `${key}: ${valueText(value)}`)
    .join('; ')

const endText = (end: ChangesetEnd | null | undefined) =>
  end === null || end === undefined ? '?' : (end.name ?? shortId(end.id))

/** The target column: an entity's name, "(new)" for a create, a relation's two ends. */
export function targetText(write: StagedWriteView): string {
  if (write.type === null || write.id === null) return '—'
  if (write.operation.endsWith('_relation')) {
    if (write.from === null && write.to === null) return shortId(write.id)
    return `${endText(write.from)} → ${endText(write.to)}`
  }
  const name = write.name ?? shortId(write.id)
  return write.operation === 'create_entity' ? `${name} (new)` : name
}

/**
 * The change column: `before → after` per key for updates (only the staged
 * value when the target was created by this changeset), with the current
 * value where it differs on a drifted write; the set values for creates,
 * with a create's parent, and "—" for deletes.
 */
export function changeText(write: StagedWriteView): string {
  if (write.type === null) return 'Not visible through this lens'
  if (write.operation.startsWith('delete_')) return '—'
  const after = write.after ?? {}
  if (write.operation.startsWith('update_')) {
    const before = write.before
    if (before === null) return valuesText(after)
    const drifted = write.markers.some((marker) => marker.kind === 'drift')
    return Object.entries(after)
      .map(([key, value]) => {
        const change = `${key}: ${valueText(before[key])} → ${valueText(value)}`
        const current = write.current?.[key]
        return drifted && current !== undefined && JSON.stringify(current) !== JSON.stringify(before[key])
          ? `${change} (now ${valueText(current)})`
          : change
      })
      .join('; ')
  }
  const parts = Object.keys(after).length === 0 ? [] : [valuesText(after)]
  if (write.operation === 'create_entity' && write.parent !== null && write.parent !== undefined) {
    const properties = write.parent.properties
    const under = `under ${endText(write.parent)}`
    parts.push(Object.keys(properties).length === 0 ? under : `${under} (${valuesText(properties)})`)
  }
  return parts.length === 0 ? '—' : parts.join(' · ')
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

/** One violation, for the panel and the note: "#15 has_children: …"; seq 0 is the whole changeset. */
export function violationLine(violation: ChangesetViolation): string {
  const where = violation.seq === 0 ? '' : `#${violation.seq} `
  return `${where}${violation.kind}: ${violation.message}`
}

/**
 * The note "Unsubmit with these violations" sends: a header with the total,
 * then one line per violation, cut to the note's limit.
 */
export function violationsNote(violations: readonly ChangesetViolation[], total: number): string {
  const header = `Commit rejected: ${total} ${total === 1 ? 'violation' : 'violations'}`
  const lines = [header, ...violations.map(violationLine)]
  if (total > violations.length) lines.push(`… and ${total - violations.length} more`)
  const note = lines.join('\n')
  return note.length <= MAX_NOTE_LENGTH ? note : `${note.slice(0, MAX_NOTE_LENGTH - 1)}…`
}

/** A commit's 409 for a version other than the one shown. */
export function isVersionMismatch(error: { status: number; message: string }): boolean {
  return error.status === 409 && error.message.includes('changed since you looked')
}

/** The cached runtime data a commit can change: entities, relations, paths, documents, anchors. */
const DATA_KEYS = new Set([
  'entities',
  'entity',
  'path',
  'document',
  'neighbors',
  'neighborCounts',
  'relations',
  'anchors',
  'palette',
])

/** Whether a query holds runtime data of this ontology that a commit can change. */
export function isCommittedDataKey(queryKey: readonly unknown[], ontologyKey: string): boolean {
  const [head, second, third] = queryKey
  if (typeof head !== 'string' || !DATA_KEYS.has(head)) return false
  // The palette's keys carry the ontology one place later: ['palette', kind, ontologyKey, …].
  return (head === 'palette' ? third : second) === ontologyKey
}
