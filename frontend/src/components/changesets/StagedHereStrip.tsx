import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileStack } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useChangesets } from '@/api/hooks'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import type { StagedWriteView } from '@/api/types'
import { changesetLabel, changeText, operationLabel, writesText } from '@/components/changesets/changesets'
import { MarkerChip } from '@/components/changesets/MarkerChip'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface StagedHereStripProps {
  ontologyKey: string
  lensKey: string
  changesetId: string
  /** The pinned changeset's writes on this entity, by seq. */
  writes: StagedWriteView[]
}

/**
 * The entity page's "Staged here" strip while a changeset is pinned: the
 * changeset's writes on this entity, each with its change, its markers and
 * Unstage, and a link to the changeset's review.
 */
export function StagedHereStrip({ ontologyKey, lensKey, changesetId, writes }: StagedHereStripProps) {
  const queryClient = useQueryClient()
  // The bar and the Sidebar read the same list under the same key.
  const item = useChangesets(ontologyKey, lensKey).data?.find((candidate) => candidate.id === changesetId)
  const submitted = item?.state === 'submitted'

  const unstage = useMutation({
    mutationFn: (seq: number) => runtime.unstageWrite(ontologyKey, lensKey, changesetId, seq),
    onSuccess: (_, seq) => toast.success(`#${seq} unstaged`),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to unstage'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.changesets(ontologyKey, lensKey) }),
  })

  return (
    <section
      aria-label="Staged here"
      className="mx-6 mt-6 overflow-hidden rounded-xl border border-(--tc-amber-border) bg-(--tc-amber-bg)"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-(--tc-amber-border) px-4 py-2">
        <FileStack className="size-3.5 shrink-0 text-(--tc-amber)" />
        <h2 className="text-[13px] font-semibold">Staged here</h2>
        <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
          {writesText(writes.length)} in {changesetLabel(item ?? { id: changesetId, note: null })}
        </span>
        <Button asChild size="xs" variant="outline" className="ml-auto">
          <Link to={`/o/${ontologyKey}/w/${lensKey}/changesets/${changesetId}`}>Open changeset</Link>
        </Button>
      </header>
      <ul className="divide-y divide-(--tc-amber-border)">
        {writes.map((write) => {
          const unstageButton = (
            <Button
              variant="outline"
              size="xs"
              aria-label={`Unstage #${write.seq}`}
              disabled={submitted || unstage.isPending}
              onClick={() => unstage.mutate(write.seq)}
            >
              Unstage
            </Button>
          )
          return (
            <li key={write.seq} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2 text-[13px]">
              <span className="text-[12.5px] text-muted-foreground tabular-nums">#{write.seq}</span>
              <span className="font-medium whitespace-nowrap">{operationLabel(write.operation)}</span>
              <div className="min-w-0 flex-1 basis-48 break-words">
                {changeText(write)}
                {write.markers.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {write.markers.map((marker, i) => (
                      <MarkerChip key={i} marker={marker} />
                    ))}
                  </div>
                )}
                {write.markers.map((marker, i) => (
                  <p key={i} className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {marker.message}
                  </p>
                ))}
              </div>
              {submitted ? (
                // A disabled button fires no pointer events: the wrapper carries the tooltip.
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>{unstageButton}</span>
                  </TooltipTrigger>
                  <TooltipContent>Submitted changesets are frozen: unsubmit it first</TooltipContent>
                </Tooltip>
              ) : (
                unstageButton
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
