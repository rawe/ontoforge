import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { Plus, Unlink } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useDisplayLabel } from '@/api/hooks'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import { useRuntimeWrites } from '@/api/writes'
import type { EntityInstance, Neighbor, SchemaEntityType } from '@/api/types'
import { useCanEdit } from '@/components/auth/useAccess'
import { TypeChip } from '@/components/TypeChip'
import type { RelationInitial } from '@/components/entity/AddRelationDialog'
import type { HierarchyLink } from '@/components/entity/hierarchy'
import { PARENT_SECTION, PARENT_TITLE } from '@/components/entity/RelationSection'
import { relationPropsSummary } from '@/components/entity/relationProps'
import { invalidateNeighborhood } from '@/components/entity/useNeighborCounts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { usePinnedChangeset } from '@/lib/pinnedChangeset'
import { cn } from '@/lib/utils'

/** Enough to show a second parent, should a race have written one. */
const LIMIT = 5

interface ParentSectionProps {
  ontologyKey: string
  lensKey: string
  entity: EntityInstance
  /** The parent relations where this entity is the child end. */
  links: readonly HierarchyLink[]
  entityTypes: readonly SchemaEntityType[]
  /** Opens Add relation: preset to the one parent relation, else the global flow. */
  onAdd: (initial: RelationInitial | undefined) => void
}

/**
 * The entity's one parent, over every parent relation where it is the child
 * end: a violet section at the top of the entity detail, with unlink.
 */
export function ParentSection({
  ontologyKey,
  lensKey,
  entity,
  links,
  entityTypes,
  onAdd,
}: ParentSectionProps) {
  const displayLabel = useDisplayLabel()
  const queryClient = useQueryClient()
  const [unlinkTarget, setUnlinkTarget] = useState<Neighbor | null>(null)
  const canEdit = useCanEdit(ontologyKey, lensKey)
  const staging = usePinnedChangeset(ontologyKey, lensKey) !== null
  const typeKey = entity._entityTypeKey

  const results = useQueries({
    queries: links.map(({ relationType, direction }) => {
      const params = { relationTypeKey: relationType.key, direction, limit: LIMIT }
      return {
        queryKey: qk.neighbors(ontologyKey, lensKey, typeKey, entity._id, params),
        queryFn: () => runtime.getNeighbors(ontologyKey, lensKey, typeKey, entity._id, params),
      }
    }),
  })
  const pending = results.some((r) => r.isPending)
  const failed = results.find((r) => r.isError)?.error
  const rows = results.flatMap((r) => r.data?.neighbors ?? [])

  const writes = useRuntimeWrites(ontologyKey, lensKey)
  const unlinkMutation = useMutation({
    mutationFn: (neighbor: Neighbor) =>
      writes.deleteRelation(neighbor.relation._relationTypeKey, neighbor.relation._id),
    onSuccess: (outcome, neighbor) => {
      setUnlinkTarget(null)
      // Staged: the parent stays in the live neighbourhood.
      if (outcome.kind === 'staged') {
        writes.toastStaged(outcome)
        return
      }
      invalidateNeighborhood(queryClient, ontologyKey, lensKey, typeKey, entity._id)
      invalidateNeighborhood(
        queryClient,
        ontologyKey,
        lensKey,
        neighbor.entity._entityTypeKey,
        neighbor.entity._id,
      )
      toast.success(`Removed the parent ${displayLabel(neighbor.entity)}`)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to remove relation')
      setUnlinkTarget(null)
    },
  })

  const typeNameOf = (key: string) =>
    entityTypes.find((t) => t.key === key)?.displayName ?? key
  const add = () =>
    onAdd(
      links.length === 1
        ? { relationType: links[0]!.relationType, direction: links[0]!.direction }
        : undefined,
    )

  return (
    <section className={cn('overflow-hidden rounded-xl border bg-card', PARENT_SECTION)}>
      <header className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
        <h3 className={PARENT_TITLE}>Parent</h3>
        <span className="truncate font-mono text-[11.5px] text-muted-foreground">
          {links.map((l) => l.relationType.key).join(' · ')}
        </span>
        {canEdit && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            aria-label="Add a parent"
            onClick={add}
          >
            <Plus className="size-3.5" />
          </Button>
        )}
      </header>

      {pending ? (
        <div className="px-4 py-3">
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : failed !== undefined ? (
        <p className="px-4 py-4 text-[13px] text-destructive">{failed.message}</p>
      ) : rows.length === 0 ? (
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-[13px] text-muted-foreground">No parent: a root.</p>
          {canEdit && (
            <Button variant="outline" size="xs" onClick={add}>
              <Plus className="size-3" /> Add
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((neighbor) => {
            const summary = relationPropsSummary(neighbor)
            return (
              <li key={neighbor.relation._id} className="group flex items-center gap-2 px-4 py-1.5">
                <TypeChip
                  typeKey={neighbor.entity._entityTypeKey}
                  displayName={typeNameOf(neighbor.entity._entityTypeKey)}
                  size="sm"
                />
                <Link
                  to={`/o/${ontologyKey}/w/${lensKey}/e/${neighbor.entity._entityTypeKey}/${neighbor.entity._id}`}
                  className="min-w-0 truncate text-[13px] font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring/60"
                >
                  {displayLabel(neighbor.entity)}
                </Link>
                {links.length > 1 && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {neighbor.relation._relationTypeKey}
                  </span>
                )}
                {summary !== '' && (
                  <span className="min-w-0 truncate text-[12px] text-muted-foreground">
                    {summary}
                  </span>
                )}
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Remove relation to ${displayLabel(neighbor.entity)}`}
                    onClick={() => setUnlinkTarget(neighbor)}
                  >
                    <Unlink className="size-3.5 text-muted-foreground" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <AlertDialog
        open={unlinkTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUnlinkTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the parent?</AlertDialogTitle>
            <AlertDialogDescription>
              {staging ? 'The removal of the ' : 'This removes the '}
              {unlinkTarget?.relation._relationTypeKey} relation
              {unlinkTarget !== null ? ` to “${displayLabel(unlinkTarget.entity)}”` : ''}
              {staging ? ' is staged into the pinned changeset' : ''}. Both entities are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlinkMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={unlinkMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (unlinkTarget !== null) unlinkMutation.mutate(unlinkTarget)
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
