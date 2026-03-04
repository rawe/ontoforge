import type { EntityInstance } from '../types/runtime';

const LABEL_CANDIDATES = ['name', 'title', 'label', 'display_name'];

export function getDisplayLabel(entity: EntityInstance): string {
  for (const key of LABEL_CANDIDATES) {
    const val = entity[key];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  for (const [key, val] of Object.entries(entity)) {
    if (key.startsWith('_') || key === 'fromEntityId' || key === 'toEntityId') continue;
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return entity._id.slice(0, 12);
}
