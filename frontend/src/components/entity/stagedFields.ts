/**
 * Pure helpers for the entity page while a changeset is pinned: the
 * properties the changeset's writes on the entity set, each with the value a
 * commit would leave and the drift found on it, and whether it deletes the
 * entity. No React, no I/O — unit-tested with `node --test`.
 */

import type { ChangesetMarker, JsonValue, StagedEntity, StagedWriteView } from '../../api/types.ts'

/** One property the staged writes set. */
export interface StagedField {
  /** The value a commit would leave; null when the staged writes remove it. */
  value: JsonValue
  /** The drift marker of a write that sets it, when its stored value changed since. */
  drift: ChangesetMarker | null
}

const same = (a: JsonValue | undefined, b: JsonValue | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** The keys of a write whose stored value changed since it was staged; all it sets when none shows. */
function driftedKeys(write: StagedWriteView): string[] {
  const keys = Object.keys(write.after ?? {})
  const changed = keys.filter((key) => !same(write.before?.[key], write.current?.[key]))
  return changed.length > 0 ? changed : keys
}

/**
 * The properties the entity's staged creates and updates set, by key, with
 * the folded value (`staged.entity`) and the drift on them. Empty when
 * nothing is staged on the entity.
 */
export function stagedFields(staged: StagedEntity): Record<string, StagedField> {
  const fields: Record<string, StagedField> = {}
  for (const write of staged.writes) {
    if (write.operation !== 'create_entity' && write.operation !== 'update_entity') continue
    for (const key of Object.keys(write.after ?? {})) {
      fields[key] = { value: staged.entity[key] ?? null, drift: fields[key]?.drift ?? null }
    }
    const drift = write.markers.find((marker) => marker.kind === 'drift')
    if (drift !== undefined) for (const key of driftedKeys(write)) fields[key].drift = drift
  }
  return fields
}

/**
 * Whether the changeset deletes the entity: any staged delete of it. A write
 * staged after the delete does not bring it back — the commit rejects it.
 */
export function deletedInChangeset(staged: StagedEntity): boolean {
  return staged.deleted || staged.writes.some((write) => write.operation === 'delete_entity')
}
