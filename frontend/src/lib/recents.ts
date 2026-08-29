/**
 * Recently opened entities, persisted per lens under `of.recents.{key}`.
 * The entity detail page records visits; the search palette shows them when
 * its input is empty. Capped at 10, most recent first, deduped by entity id.
 */

import { readJson, storageKeys, writeJson } from '@/lib/storage'

export interface RecentEntity {
  id: string
  typeKey: string
  label: string
  /** Epoch millis of the last visit. */
  at: number
}

const MAX_RECENTS = 10

export function readRecents(lensKey: string): RecentEntity[] {
  const raw = readJson<unknown>(storageKeys.recents(lensKey))
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (r): r is RecentEntity =>
      r !== null &&
      typeof r === 'object' &&
      typeof (r as RecentEntity).id === 'string' &&
      typeof (r as RecentEntity).typeKey === 'string' &&
      typeof (r as RecentEntity).label === 'string',
  )
}

export function recordRecent(
  lensKey: string,
  entry: Omit<RecentEntity, 'at'>,
): void {
  const next: RecentEntity[] = [
    { ...entry, at: Date.now() },
    ...readRecents(lensKey).filter((r) => r.id !== entry.id),
  ].slice(0, MAX_RECENTS)
  writeJson(storageKeys.recents(lensKey), next)
}
