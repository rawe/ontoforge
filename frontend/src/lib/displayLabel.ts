import type { EntityInstance } from '@/api/types'

/**
 * Human-readable label for an entity instance (parity with legacy):
 * `name` → `title` → `label` → `display_name` → first non-underscore string
 * prop → truncated `_id`.
 */
export function displayLabel(entity: EntityInstance): string {
  for (const key of ['name', 'title', 'label', 'display_name']) {
    const value = entity[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  for (const [key, value] of Object.entries(entity)) {
    if (key.startsWith('_')) continue
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return entity._id.slice(0, 12)
}
