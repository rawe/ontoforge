import { FileStack } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useChangesets } from '@/api/hooks'
import type { StagedObjectView } from '@/api/types'
import { changesetLabel } from '@/components/changesets/changesets'
import { FROZEN_REASON, StagedObjectCard } from '@/components/changesets/StagedObjectCard'
import { useStagedObjectActions } from '@/components/changesets/useStagedObjectActions'
import { Button } from '@/components/ui/button'

interface StagedHereStripProps {
  ontologyKey: string
  lensKey: string
  changesetId: string
  /** The pinned changeset's staged object of this entity. */
  object: StagedObjectView
}

/**
 * The entity page's "Staged here" strip while a changeset is pinned: the
 * changeset's staged object of this entity — its action, its values and
 * markers, remove, cut and accept current — and a link to the changeset's
 * review.
 */
export function StagedHereStrip({ ontologyKey, lensKey, changesetId, object }: StagedHereStripProps) {
  // The bar and the Sidebar read the same list under the same key.
  const item = useChangesets(ontologyKey, lensKey).data?.find((candidate) => candidate.id === changesetId)
  const actions = useStagedObjectActions(ontologyKey, lensKey, changesetId)

  return (
    <section
      aria-label="Staged here"
      className="mx-6 mt-6 overflow-hidden rounded-xl border border-(--tc-amber-border) bg-(--tc-amber-bg)"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-(--tc-amber-border) px-4 py-2">
        <FileStack className="size-3.5 shrink-0 text-(--tc-amber)" />
        <h2 className="text-[13px] font-semibold">Staged here</h2>
        <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
          in {changesetLabel(item ?? { id: changesetId, note: null })}
        </span>
        <Button asChild size="xs" variant="outline" className="ml-auto">
          <Link to={`/o/${ontologyKey}/w/${lensKey}/changesets/${changesetId}`}>Open changeset</Link>
        </Button>
      </header>
      <StagedObjectCard
        object={object}
        frozen={item?.state === 'submitted' ? FROZEN_REASON : null}
        busy={actions.busy}
        onRemove={() => actions.remove.mutate(object.id)}
        onCut={(property) => actions.cut.mutate({ objectId: object.id, property })}
        onAcceptCurrent={(property) => actions.acceptCurrent.mutate({ objectId: object.id, property })}
        className="rounded-none border-0 bg-transparent px-1"
      />
    </section>
  )
}
