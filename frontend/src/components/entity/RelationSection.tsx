import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowLeftRight, ArrowRight, Plus, Unlink } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import type {
  EntityInstance,
  Neighbor,
  NeighborDirection,
  SchemaEntityType,
  SchemaRelationType,
} from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import type { RelationInitial } from '@/components/entity/AddRelationDialog'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { displayLabel } from '@/lib/displayLabel'

const PAGE_SIZE = 10
const MAX_LIMIT = 200

/** Non-system relation props as a compact "key: value" summary. */
function relationPropsSummary(neighbor: Neighbor): string {
  return Object.entries(neighbor.relation)
    .filter(
      ([key]) =>
        !key.startsWith('_') &&
        key !== 'fromEntityId' &&
        key !== 'toEntityId' &&
        key !== 'direction',
    )
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ')
}

interface RelationSectionProps {
  ontologyKey: string
  entity: EntityInstance
  relationType: SchemaRelationType
  entityTypes: readonly SchemaEntityType[]
  /** Exact neighbor count for this relation type (both directions summed). */
  count: number | undefined
  onAdd: (initial: RelationInitial) => void
}

/**
 * One relation type's neighborhood: direction-aware heading, count badge,
 * neighbor rows (link + relation-prop summary + unlink) and "Show N more"
 * pagination via a limit bump on /neighbors.
 */
export function RelationSection({
  ontologyKey,
  entity,
  relationType,
  entityTypes,
  count,
  onAdd,
}: RelationSectionProps) {
  const queryClient = useQueryClient()
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [unlinkTarget, setUnlinkTarget] = useState<Neighbor | null>(null)

  const myTypeKey = entity._entityTypeKey
  const isOutgoing = relationType.fromEntityTypeKey === myTypeKey
  const isIncoming = relationType.toEntityTypeKey === myTypeKey
  const direction: NeighborDirection =
    isOutgoing && isIncoming ? 'both' : isOutgoing ? 'outgoing' : 'incoming'

  const params = { relationTypeKey: relationType.key, direction, limit }
  const neighbors = useQuery({
    queryKey: qk.neighbors(ontologyKey, myTypeKey, entity._id, params),
    queryFn: () => runtime.getNeighbors(ontologyKey, myTypeKey, entity._id, params),
  })

  const unlinkMutation = useMutation({
    mutationFn: (neighbor: Neighbor) =>
      runtime.deleteRelation(ontologyKey, relationType.key, neighbor.relation._id),
    onSuccess: (_res, neighbor) => {
      invalidateNeighborhood(queryClient, ontologyKey, myTypeKey, entity._id)
      invalidateNeighborhood(
        queryClient,
        ontologyKey,
        neighbor.entity._entityTypeKey,
        neighbor.entity._id,
      )
      toast.success(`Removed ${relationType.displayName} to ${displayLabel(neighbor.entity)}`)
      setUnlinkTarget(null)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to remove relation')
      setUnlinkTarget(null)
    },
  })

  const typeNameOf = (key: string) =>
    entityTypes.find((t) => t.key === key)?.displayName ?? key

  const rows = neighbors.data?.neighbors ?? []
  const remaining = count !== undefined ? Math.max(count - rows.length, 0) : undefined
  const canShowMore =
    limit < MAX_LIMIT &&
    (remaining !== undefined ? remaining > 0 && rows.length >= limit : rows.length >= limit)

  const otherTypeKey = isOutgoing
    ? relationType.toEntityTypeKey
    : relationType.fromEntityTypeKey

  const DirectionIcon =
    direction === 'both' ? ArrowLeftRight : direction === 'outgoing' ? ArrowRight : ArrowLeft

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
        <DirectionIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <h3 className="text-[13px] font-semibold">{relationType.displayName}</h3>
        <span className="truncate text-[12px] text-muted-foreground">
          {direction === 'both'
            ? `${typeNameOf(otherTypeKey)} · both directions`
            : direction === 'outgoing'
              ? `to ${typeNameOf(otherTypeKey)}`
              : `from ${typeNameOf(otherTypeKey)}`}
        </span>
        <Badge variant="secondary" className="ml-auto font-mono text-[10.5px]">
          {count ?? '…'}
        </Badge>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Add ${relationType.displayName} relation`}
          onClick={() => {
            const initial: RelationInitial =
              direction === 'both'
                ? { relationType }
                : { relationType, direction }
            onAdd(initial)
          }}
        >
          <Plus className="size-3.5" />
        </Button>
      </header>

      {neighbors.isPending ? (
        <div className="space-y-2 px-4 py-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : neighbors.isError ? (
        <p className="px-4 py-4 text-[13px] text-destructive">
          {neighbors.error instanceof Error
            ? neighbors.error.message
            : 'Failed to load neighbors'}
        </p>
      ) : rows.length === 0 ? (
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-[13px] text-muted-foreground">
            No {relationType.displayName} relations yet.
          </p>
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              onAdd(
                direction === 'both' ? { relationType } : { relationType, direction },
              )
            }
          >
            <Plus className="size-3" /> Add
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((neighbor) => {
            const summary = relationPropsSummary(neighbor)
            const RowIcon =
              neighbor.relation.direction === 'outgoing' ? ArrowRight : ArrowLeft
            return (
              <li
                key={neighbor.relation._id}
                className="group flex items-center gap-2 px-4 py-1.5"
              >
                {direction === 'both' && (
                  <RowIcon className="size-3 shrink-0 text-muted-foreground" />
                )}
                <TypeChip
                  typeKey={neighbor.entity._entityTypeKey}
                  displayName={typeNameOf(neighbor.entity._entityTypeKey)}
                  size="sm"
                />
                <Link
                  to={`/w/${ontologyKey}/e/${neighbor.entity._entityTypeKey}/${neighbor.entity._id}`}
                  className="min-w-0 truncate text-[13px] font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring/60"
                >
                  {displayLabel(neighbor.entity)}
                </Link>
                {summary !== '' && (
                  <span className="min-w-0 truncate text-[12px] text-muted-foreground">
                    {summary}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Remove relation to ${displayLabel(neighbor.entity)}`}
                  onClick={() => setUnlinkTarget(neighbor)}
                >
                  <Unlink className="size-3.5 text-muted-foreground" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {canShowMore && (
        <div className="border-t px-4 py-1.5">
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            disabled={neighbors.isFetching}
            onClick={() => setLimit((prev) => Math.min(prev + PAGE_SIZE, MAX_LIMIT))}
          >
            {remaining !== undefined
              ? `Show ${Math.min(remaining, PAGE_SIZE)} more`
              : 'Show more'}
          </Button>
        </div>
      )}

      <AlertDialog
        open={unlinkTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUnlinkTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove relation?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the {relationType.displayName} relation
              {unlinkTarget !== null
                ? ` to “${displayLabel(unlinkTarget.entity)}”`
                : ''}
              . Both entities are kept.
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
