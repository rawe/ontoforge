import { Pin, PinOff } from 'lucide-react'
import type { Changeset } from '@/api/types'
import { useAccess } from '@/components/auth/useAccess'
import { Button } from '@/components/ui/button'
import { pinChangeset, unpinChangeset, usePinnedChangeset } from '@/lib/pinnedChangeset'

/**
 * "Work in this changeset" on a draft pins it (replacing any pinned one);
 * "Leave" on the pinned one unpins it. Nothing on a submitted one not pinned,
 * nor for a Reader of the lens, whose writes could not be staged.
 */
export function PinChangesetButton({
  ontologyKey,
  lensKey,
  changeset,
  size = 'sm',
}: {
  ontologyKey: string
  lensKey: string
  changeset: Pick<Changeset, 'id' | 'state'>
  size?: 'sm' | 'xs'
}) {
  const pinned = usePinnedChangeset(ontologyKey, lensKey)
  const canWrite = useAccess().canWrite(ontologyKey, lensKey)
  if (pinned === changeset.id) {
    return (
      <Button size={size} variant="outline" onClick={() => unpinChangeset(ontologyKey, lensKey)}>
        <PinOff className={size === 'sm' ? 'size-3.5' : undefined} />
        Leave
      </Button>
    )
  }
  if (changeset.state !== 'draft' || !canWrite) return null
  return (
    <Button size={size} variant="outline" onClick={() => pinChangeset(ontologyKey, lensKey, changeset.id)}>
      <Pin className={size === 'sm' ? 'size-3.5' : undefined} />
      Work in this changeset
    </Button>
  )
}
