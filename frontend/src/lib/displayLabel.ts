import type { EntityInstance, RuntimeSchema } from '@/api/types'

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

/** Entity type key → name property key (null when the lens hides it). */
export function nameProperties(
  schema: RuntimeSchema | undefined,
): ReadonlyMap<string, string | null> {
  return new Map((schema?.entityTypes ?? []).map((t) => [t.key, t.nameProperty]))
}
