import { FileStack } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useChangesets } from '@/api/hooks'
import { changesetLabel, objectsText } from '@/components/changesets/changesets'
import { Button } from '@/components/ui/button'
import { pinnedChangeset, unpinChangeset, usePinnedChangeset } from '@/lib/pinnedChangeset'

/** The bar's toast when the list no longer shows the pinned changeset; it is unpinned. */
const BAR_CHANGESET_GONE_TEXT = 'The changeset is gone (committed, discarded or expired) — you are editing live again.'

/**
 * The strip above every Workbench page while a changeset is pinned: which
 * one, its staged objects, Review and Leave. A pinned changeset the list does not
 * show is read again; still missing from that read, it is gone: unpinned
 * with a toast.
 */
export function ChangesetBar({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  const pinned = usePinnedChangeset(ontologyKey, lensKey)
  // The Sidebar reads the same list under the same key.
  const list = useChangesets(ontologyKey, pinned === null ? undefined : lensKey)
  const item = list.data?.find((candidate) => candidate.id === pinned)
  const missing = pinned !== null && list.data !== undefined && item === undefined
  const { refetch, dataUpdatedAt: listReadAt } = list

  useEffect(() => {
    if (!missing) return
    // The list shown may have been read before the pin (here or in another
    // tab); refetch cancels a read in flight, so this one starts after it.
    // Judged only on a read that landed: a cancelled or failed one answers
    // the old list (a read landing later runs this again).
    const startedAt = Date.now()
    void refetch().then(({ data, dataUpdatedAt }) => {
      if (data === undefined || dataUpdatedAt < startedAt) return
      const listed = data.some((candidate) => candidate.id === pinned)
      // Only while it is still the pinned one: another tab may have moved on.
      if (!listed && pinnedChangeset(ontologyKey, lensKey) === pinned) {
        unpinChangeset(ontologyKey, lensKey)
        toast.warning(BAR_CHANGESET_GONE_TEXT)
      }
    })
  }, [missing, listReadAt, pinned, ontologyKey, lensKey, refetch])

  if (pinned === null) return null

  return (
    <div
      role="status"
      aria-label="Pinned changeset"
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-(--tc-amber-border) bg-(--tc-amber-bg) px-6 py-1.5 text-[13px]"
    >
      {/* Narrow: only the label truncates; the count and the state wrap whole. */}
      <span className="flex min-w-0 items-center gap-2">
        <FileStack className="size-3.5 shrink-0 text-(--tc-amber)" />
        <span className="truncate">
          Working in changeset <span className="font-medium">{changesetLabel(item ?? { id: pinned, note: null })}</span>
        </span>
      </span>
      {item !== undefined && <span className="whitespace-nowrap">· {objectsText(item.objectCount)}</span>}
      {item?.state === 'submitted' && (
        <span className="whitespace-nowrap font-medium text-(--tc-amber)">· Submitted — staging is refused</span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button asChild size="xs" variant="outline">
          <Link to={`/o/${ontologyKey}/w/${lensKey}/changesets/${pinned}`}>Review</Link>
        </Button>
        <Button size="xs" variant="ghost" onClick={() => unpinChangeset(ontologyKey, lensKey)}>
          Leave
        </Button>
      </div>
    </div>
  )
}
