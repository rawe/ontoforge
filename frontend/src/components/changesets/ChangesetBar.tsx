import { FileStack } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useChangesets } from '@/api/hooks'
import { CHANGESET_GONE_TEXT } from '@/api/writes'
import { changesetLabel, pinnedInList, writesText } from '@/components/changesets/changesets'
import { Button } from '@/components/ui/button'
import { pinnedChangedAt, pinnedChangeset, unpinChangeset, usePinnedChangeset } from '@/lib/pinnedChangeset'

/**
 * The strip above every Workbench page while a changeset is pinned: which
 * one, its writes, Review and Leave. A pinned changeset the list no longer
 * shows is gone: it is unpinned with a toast.
 */
export function ChangesetBar({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  const pinned = usePinnedChangeset(ontologyKey, lensKey)
  // The Sidebar reads the same list under the same key.
  const list = useChangesets(ontologyKey, pinned === null ? undefined : lensKey)
  const found =
    pinned === null || list.data === undefined
      ? undefined
      : pinnedInList(pinned, list.data, list.dataUpdatedAt, pinnedChangedAt(ontologyKey, lensKey))
  const { refetch } = list

  useEffect(() => {
    if (found === 'stale') void refetch()
    // Only while it is still the pinned one: another tab may have moved on.
    else if (found === 'gone' && pinnedChangeset(ontologyKey, lensKey) === pinned) {
      unpinChangeset(ontologyKey, lensKey)
      toast.warning(CHANGESET_GONE_TEXT)
    }
  }, [found, pinned, ontologyKey, lensKey, refetch])

  if (pinned === null) return null
  const item = typeof found === 'object' ? found : undefined

  return (
    <div
      role="status"
      aria-label="Pinned changeset"
      className="flex shrink-0 items-center gap-2 border-b border-(--tc-amber-border) bg-(--tc-amber-bg) px-6 py-1.5 text-[13px]"
    >
      <FileStack className="size-3.5 shrink-0 text-(--tc-amber)" />
      <span className="min-w-0 truncate">
        Working in changeset <span className="font-medium">{changesetLabel(item ?? { id: pinned, note: null })}</span>
        {item !== undefined && ` · ${writesText(item.writeCount)}`}
        {item?.state === 'submitted' && (
          <span className="font-medium text-(--tc-amber)"> · Submitted — staging is refused</span>
        )}
      </span>
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
