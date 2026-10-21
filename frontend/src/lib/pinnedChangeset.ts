/**
 * The pinned changeset of a lens: the draft the Workbench's writes stage
 * into instead of writing at once (`api/writes.ts`). Stored per ontology +
 * lens under `of.changeset.{o}.{l}`; a small external store that also
 * follows the `storage` event, so every open tab follows a pin or a leave
 * at once. A pin localStorage cannot hold is kept in memory for this tab
 * only; other tabs then do not follow it.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { readString, remove, storageKeys, writeString } from '@/lib/storage'

const listeners = new Set<() => void>()

// Pins this tab could not store, by storage key.
const inMemory = new Map<string, string>()

function changed() {
  listeners.forEach((l) => l())
}

// Another tab pinned or left (key null: storage was cleared).
function onStorage(e: StorageEvent) {
  if (e.key === null || e.key.startsWith('of.changeset.')) changed()
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
  const key = storageKeys.changeset(ontologyKey, lensKey)
  return inMemory.get(key) ?? readString(key)
}

/** Pins a changeset; one pinned before is simply replaced. */
export function pinChangeset(ontologyKey: string, lensKey: string, changesetId: string): void {
  const key = storageKeys.changeset(ontologyKey, lensKey)
  writeString(key, changesetId)
  if (readString(key) === changesetId) inMemory.delete(key)
  else inMemory.set(key, changesetId)
  changed()
}

/** Leaves the pinned changeset: writes are live again. */
export function unpinChangeset(ontologyKey: string, lensKey: string): void {
  const key = storageKeys.changeset(ontologyKey, lensKey)
  inMemory.delete(key)
  remove(key)
  changed()
}

export function usePinnedChangeset(ontologyKey: string, lensKey: string): string | null {
  const snapshot = useCallback(() => pinnedChangeset(ontologyKey, lensKey), [ontologyKey, lensKey])
  return useSyncExternalStore(subscribe, snapshot)
}
