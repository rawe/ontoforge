import type { EntityInstance, JsonValue, RuntimeSchema } from '@/api/types'

/**
 * Human-readable label for an entity instance: the value of its type's name
 * property when that is a non-empty string, else the truncated `_id`.
 * `nameProperty` is null when the lens hides the name property.
 */
export function displayLabel(
  entity: EntityInstance,
  nameProperty: string | null | undefined,
): string {
  return nameValue(entity, nameProperty) ?? entity._id.slice(0, 12)
}

/** The name property's value in a property bag, or null when absent or empty. */
export function nameValue(
  properties: Record<string, JsonValue>,
  nameProperty: string | null | undefined,
): string | null {
  if (nameProperty === null || nameProperty === undefined) return null
  const value = properties[nameProperty]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Entity type key → name property key (null when the lens hides it). */
export function nameProperties(
  schema: RuntimeSchema | undefined,
): ReadonlyMap<string, string | null> {
  return new Map((schema?.entityTypes ?? []).map((t) => [t.key, t.nameProperty]))
}
