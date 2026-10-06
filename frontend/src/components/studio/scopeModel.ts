/**
 * Pure helpers for the lens Scope tab: name-property visibility and
 * search-index inclusions. No React, no I/O — unit-tested with `node --test`.
 * The server stays authoritative; these rules only keep the UI from
 * offering what it rejects.
 */

import type { ScopeInclude, SearchIndexRecord } from '@/api/types'

/**
 * True when an entity type include hides the type's name property — labels
 * in the lens then fall back to the truncated id. `properties: null`
 * exposes every property.
 */
export function hidesNameProperty(include: ScopeInclude | undefined, nameProperty: string): boolean {
  return include?.properties != null && !include.properties.includes(nameProperty)
}

/**
 * The managed indices (default and passages) rooted on an entity type —
 * the ones pre-selected when the type is included in a scoped lens.
 * Switched-off ones are included too: the switch is ontology-wide, the
 * inclusion is the lens's.
 */
export function managedIndexKeysFor(
  records: readonly SearchIndexRecord[],
  entityTypeKey: string,
): string[] {
  return records
    .filter((r) => r.kind !== 'custom' && r.definition.entityType === entityTypeKey)
    .map((r) => r.key)
}

export type IndexInclusionState =
  /** Checked; can be unticked. */
  | { included: true; rootMissing: boolean }
  /** Unchecked; can be ticked only when the root type is in scope. */
  | { included: false; canInclude: boolean }

/**
 * Checkbox state of one index in a scoped lens. An included index whose root
 * type is no longer in scope stays untickable and is flagged.
 */
export function indexInclusionState(
  record: SearchIndexRecord,
  includedIndexKeys: ReadonlySet<string>,
  includedEntityTypeKeys: ReadonlySet<string>,
): IndexInclusionState {
  const rootIncluded = includedEntityTypeKeys.has(record.definition.entityType)
  return includedIndexKeys.has(record.key)
    ? { included: true, rootMissing: !rootIncluded }
    : { included: false, canInclude: rootIncluded }
}

/**
 * Indices in scope-checklist order: grouped by root entity type in the
 * given type order (unknown roots last), key order within a type.
 */
export function orderByRootType(
  records: readonly SearchIndexRecord[],
  entityTypeOrder: readonly string[],
): SearchIndexRecord[] {
  const rank = (key: string) => {
    const i = entityTypeOrder.indexOf(key)
    return i === -1 ? entityTypeOrder.length : i
  }
  return [...records].sort(
    (a, b) =>
      rank(a.definition.entityType) - rank(b.definition.entityType) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )
}
