/**
 * The pinned changeset of a lens: the draft the Workbench's writes stage
 * into instead of writing at once (`api/writes.ts`). Stored per ontology +
 * lens under `of.changeset.{o}.{l}`; a small external store that also
 * follows the `storage` event, so every open tab follows a pin or a leave
 * at once.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { readString, remove, storageKeys, writeString } from '@/lib/storage'

const listeners = new Set<() => void>()
/** When this tab last saw each key's pin change: a list read older than that may not show it yet. */
const changedAt = new Map<string, number>()

function changed(key: string) {
  changedAt.set(key, Date.now())
  listeners.forEach((l) => l())
}

// Another tab pinned or left (key null: storage was cleared).
function onStorage(e: StorageEvent) {
  if (e.key === null) listeners.forEach((l) => l())
  else if (e.key.startsWith('of.changeset.')) changed(e.key)
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

/** The lens's pinned changeset id now, or null: live writes. */
export function pinnedChangeset(ontologyKey: string, lensKey: string): string | null {
  return readString(storageKeys.changeset(ontologyKey, lensKey))
}

/** When this tab last saw the lens's pin change (0: not since it loaded). */
export function pinnedChangedAt(ontologyKey: string, lensKey: string): number {
  return changedAt.get(storageKeys.changeset(ontologyKey, lensKey)) ?? 0
}

/** Pins a changeset; one pinned before is simply replaced. */
export function pinChangeset(ontologyKey: string, lensKey: string, changesetId: string): void {
  const key = storageKeys.changeset(ontologyKey, lensKey)
  writeString(key, changesetId)
  changed(key)
}

/** Leaves the pinned changeset: writes are live again. */
export function unpinChangeset(ontologyKey: string, lensKey: string): void {
  const key = storageKeys.changeset(ontologyKey, lensKey)
  remove(key)
  changed(key)
}

export function usePinnedChangeset(ontologyKey: string, lensKey: string): string | null {
  const snapshot = useCallback(() => pinnedChangeset(ontologyKey, lensKey), [ontologyKey, lensKey])
  return useSyncExternalStore(subscribe, snapshot)
}
