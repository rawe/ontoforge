/**
 * Pure helpers for the entity page while a changeset is pinned: the
 * properties the entity's staged object sets, each with the value a commit
 * would leave and the drift found on it. No React, no I/O — unit-tested
 * with `node --test`.
 */

import type { ChangesetMarker, JsonValue, StagedEntity } from '../../api/types.ts'

/** One property the staged object sets. */
export interface StagedField {
  /** The value a commit would leave; null when the staged value removes it. */
  value: JsonValue
  /** The drift marker on its staged value, when its stored value changed since. */
  drift: ChangesetMarker | null
}

/**
 * The properties the entity's staged create or update sets, by key, with
 * the value a commit would leave (`staged.entity`) and the drift on it.
 * Empty when nothing is staged on the entity, and on a staged delete.
 */
export function stagedFields(staged: StagedEntity): Record<string, StagedField> {
  const object = staged.object
  if (object === null || object.action === 'delete') return {}
  return Object.fromEntries(
    object.values.map((value) => [
      value.property,
      {
        value: staged.entity[value.property] ?? null,
        drift: value.markers.find((marker) => marker.kind === 'drift') ?? null,
      },
    ]),
  )
}
