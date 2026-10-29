import type { EntityInstance, EntityReference, JsonValue, RuntimeSchema } from '@/api/types'

/**
 * Human-readable label for an entity instance: the value of its type's name
 * property when that is a non-empty string, else the truncated `_id`.
 * `nameProperty` is null when the lens hides the name property.
 */
export function displayLabel(
  entity: EntityInstance,
  nameProperty: string | null | undefined,
): string {
  const value = nameProperty === null || nameProperty === undefined ? undefined : entity[nameProperty]
  return typeof value === 'string' && value.trim() !== '' ? value : entity._id.slice(0, 12)
}

/** The label of an entity as a search names it: its name, else the truncated `_id`. */
export function referenceLabel(entity: EntityReference): string {
  return entity.name ?? entity._id.slice(0, 12)
}

/**
 * An identity given as its properties (a search item's `identity`) in its
 * text form, as `_identity` reads: the values in order, joined with `~`; a
 * string writes `%` as `%25` and `~` as `%7E`.
 */
export function identityText(identity: Readonly<Record<string, JsonValue>>): string {
  return Object.values(identity)
    .map((value) => (typeof value === 'string' ? value.replaceAll('%', '%25').replaceAll('~', '%7E') : String(value)))
    .join('~')
}

/** Entity type key → name property key (null when the lens hides it). */
export function nameProperties(
  schema: RuntimeSchema | undefined,
): ReadonlyMap<string, string | null> {
  return new Map((schema?.entityTypes ?? []).map((t) => [t.key, t.nameProperty]))
}
