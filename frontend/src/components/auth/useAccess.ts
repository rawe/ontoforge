import { useMemo } from 'react'
import { useAuthMe } from '@/api/hooks'
import { accessFrom, type Access } from '@/lib/access'
import { usePinnedChangeset } from '@/lib/pinnedChangeset'

/** What the signed-in user may do; everything when authentication is off, nothing while unknown. */
export function useAccess(): Access {
  const { data } = useAuthMe()
  return useMemo(() => accessFrom(data), [data])
}

/**
 * Whether the Workbench offers editing on a lens: a Writer always, a
 * Proposer while a changeset is pinned, since its writes can only be
 * staged (`api/writes.ts`).
 */
export function useCanEdit(ontologyKey: string, lensKey: string): boolean {
  const access = useAccess()
  const pinned = usePinnedChangeset(ontologyKey, lensKey)
  return access.canWrite(ontologyKey, lensKey) || (pinned !== null && access.canStage(ontologyKey, lensKey))
}
