/**
 * Pure helpers for the entity form's edit mode ("Edit values…" on an entity
 * a changeset creates): which properties a person changed, and the patch
 * they make. No React, no I/O — unit-tested with `node --test`.
 */

import type { JsonValue, SchemaProperty } from '../../api/types.ts'

/** The properties whose draft differs from the one the form started with. */
export function changedProperties(
  properties: readonly SchemaProperty[],
  initial: Readonly<Record<string, string>>,
  drafts: Readonly<Record<string, string>>,
): SchemaProperty[] {
  return properties.filter((p) => (drafts[p.key] ?? '') !== (initial[p.key] ?? ''))
}

/** The patch of an edit: each changed property's coerced value, a cleared one as null (removes it). */
export function editPatch(
  changed: readonly SchemaProperty[],
  values: Readonly<Record<string, JsonValue>>,
): Record<string, JsonValue> {
  return Object.fromEntries(changed.map((p) => [p.key, values[p.key] ?? null]))
}
