import type { Neighbor } from '@/api/types'

/** Non-system relation props as a compact "key: value" summary. */
export function relationPropsSummary(neighbor: Neighbor): string {
  return Object.entries(neighbor.relation)
    .filter(
      ([key]) =>
        !key.startsWith('_') &&
        key !== 'fromEntityId' &&
        key !== 'toEntityId' &&
        key !== 'direction',
    )
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`,
    )
    .join(' · ')
}
