/**
 * Draft fill's pure parts: reading the draft tool's proposal, whether it
 * still fits the open editor (same ontology, same agent or new-agent
 * session, same draft version), which of its fields change the draft,
 * filling it with a record of the AI's edit, the AI marks, retiring the
 * record of a field the person edits, and undoing the AI's edit for the
 * fields the person has not edited since.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */

/** An editor's fillable values by field. A list counts as a set: its order changes nothing. */
export type Fields = Record<string, unknown>

/** Which draft: one lens's agent, `agentKey` null for a new one. */
export interface DraftTarget {
  lensKey: string
  agentKey: string | null
}

/** The open editor's draft as the panel sends it: its target, version and values. */
export interface DraftState {
  ontologyKey: string
  target: DraftTarget
  /** Changes on every edit and never repeats, so a version names one editor session's one state. */
  version: number
  fields: Fields
}

/** The draft tool's result: the fields it proposes for the draft of `target` at `sourceVersion`. */
export interface DraftProposal {
  target: DraftTarget
  sourceVersion: number
  fields: Fields
}

/** The open draft editor, as the assistant panel reaches it. */
export interface DraftEditor {
  /** The draft right now. */
  state(): DraftState
  /** Fill the proposal into the draft if it still fits and the editor takes fills now; else why not, changing nothing. */
  fill(ontologyKey: string, proposal: DraftProposal): FillOutcome
}

/** A fill's outcome: done; refused for another draft or version; refused while the editor saves or deletes. */
export type FillOutcome = 'filled' | 'stale' | 'busy'

/** One field the AI changed: its value before the fill and the AI's. */
export interface FieldChange {
  before: unknown
  after: unknown
}

/** The AI's edit of a draft, by field; empty for none. */
export type AiEdit = Record<string, FieldChange>

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The proposal a draft tool's result holds; null for any other result. */
export function proposalOf(result: unknown): DraftProposal | null {
  if (!isRecord(result) || !isRecord(result.target) || !isRecord(result.fields)) return null
  const { lensKey, agentKey } = result.target
  if (typeof lensKey !== 'string' || (agentKey !== null && typeof agentKey !== 'string')) return null
  if (typeof result.sourceVersion !== 'number') return null
  return { target: { lensKey, agentKey }, sourceVersion: result.sourceVersion, fields: result.fields }
}

/** Whether two field values are the same; lists as sets. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item) => b.includes(item)) && b.every((item) => a.includes(item))
  }
  return a === b
}

/** Whether the proposal no longer fits the open draft: another (or no) editor, or a newer version. */
export function isStale(open: DraftState | null, ontologyKey: string, proposal: DraftProposal): boolean {
  return open === null
    || open.ontologyKey !== ontologyKey
    || open.target.lensKey !== proposal.target.lensKey
    || open.target.agentKey !== proposal.target.agentKey
    || open.version !== proposal.sourceVersion
}

/** Why the open editor refuses the proposal now, null if it takes it: stale, or busy while it saves or deletes. */
export function fillRefusal(open: DraftState | null, busy: boolean, ontologyKey: string, proposal: DraftProposal): 'stale' | 'busy' | null {
  if (isStale(open, ontologyKey, proposal)) return 'stale'
  return busy ? 'busy' : null
}

/** The fields of the draft the proposal changes; fields the draft does not have are left out. */
export function changedFields(current: Fields, proposed: Fields): string[] {
  return Object.keys(proposed).filter((field) => Object.hasOwn(current, field) && !sameValue(current[field], proposed[field]))
}

/**
 * The draft with the proposal filled in, and the AI's edit so far. A field
 * the AI changed before and the person left alone keeps its value from
 * before the first fill; a field back at that value is no AI change.
 */
export function applyFill<F extends Fields>(current: F, proposed: Fields, previous: AiEdit): { fields: F; edit: AiEdit } {
  const fields: Fields = { ...current }
  const edit: AiEdit = { ...previous }
  for (const field of changedFields(current, proposed)) {
    const earlier = previous[field]
    const before = earlier !== undefined && sameValue(current[field], earlier.after) ? earlier.before : current[field]
    fields[field] = proposed[field]
    if (sameValue(before, proposed[field])) delete edit[field]
    else edit[field] = { before, after: proposed[field] }
  }
  return { fields: fields as F, edit }
}

/**
 * The AI's edit after a person's change of the draft from `before` to
 * `after`: a field the change touches is the person's for good, even if
 * they later type the AI's value again; the other fields keep their record.
 */
export function withoutEdited(edit: AiEdit, before: Fields, after: Fields): AiEdit {
  return Object.fromEntries(Object.entries(edit).filter(([field]) => sameValue(before[field], after[field])))
}

/** The AI changes the draft still shows: the fields that hold the AI's value. */
export function aiMarks(current: Fields, edit: AiEdit): AiEdit {
  return Object.fromEntries(Object.entries(edit).filter(([field, change]) => sameValue(current[field], change.after)))
}

/** The draft with the AI's edit undone: each field still at the AI's value is back to its value before; the rest stay. */
export function undoFill<F extends Fields>(current: F, edit: AiEdit): F {
  const fields: Fields = { ...current }
  for (const [field, change] of Object.entries(aiMarks(current, edit))) fields[field] = change.before
  return fields as F
}
