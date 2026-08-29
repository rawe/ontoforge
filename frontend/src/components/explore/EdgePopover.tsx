import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ExternalLink, Loader2, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import * as runtime from '@/api/runtime'
import type { EntityInstance, SchemaRelationType } from '@/api/types'
import { invalidateNeighborhood } from '@/components/entity/useNeighborCounts'
import { formatValue } from '@/components/schema/propertyDraft'
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
import { displayLabel } from '@/lib/displayLabel'
import type { RelationFlowEdge } from './workingSet'

const POPOVER_WIDTH = 300

interface EdgePopoverProps {
  lensKey: string
  edge: RelationFlowEdge
  /** Screen coordinates of the click that opened the popover. */
  at: { x: number; y: number }
  sourceEntity: EntityInstance | undefined
  targetEntity: EntityInstance | undefined
  relationType: SchemaRelationType | undefined
  onClose: () => void
  /** Called after the relation was deleted on the server. */
  onDeleted: (edgeId: string) => void
}

/**
 * Small floating card on edge click: relation type, endpoints (with links to
 * both entity details), relation props and a confirmed delete action.
 */
export function EdgePopover({
  lensKey,
  edge,
  at,
  sourceEntity,
  targetEntity,
  relationType,
  onClose,
  onDeleted,
}: EdgePopoverProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const ref = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState(false)

  const relation = edge.data?.relation

  // Click-away + Escape. The confirm AlertDialog is portalled outside the
  // card, so click-away is suspended while it is open.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (confirming) return
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirming) onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, confirming])

  const deleteMutation = useMutation({
    mutationFn: () =>
      runtime.deleteRelation(lensKey, relation!._relationTypeKey, relation!._id),
    onSuccess: () => {
      if (sourceEntity !== undefined) {
        invalidateNeighborhood(
          queryClient,
          lensKey,
          sourceEntity._entityTypeKey,
          sourceEntity._id,
        )
      }
      if (targetEntity !== undefined) {
        invalidateNeighborhood(
          queryClient,
          lensKey,
          targetEntity._entityTypeKey,
          targetEntity._id,
        )
      }
      toast.success(`${relationType?.displayName ?? 'Relation'} deleted`)
      onDeleted(edge.id)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete relation')
      setConfirming(false)
    },
  })

  if (relation === undefined) return null

  const props = Object.entries(relation).filter(
    ([key]) => !key.startsWith('_') && key !== 'fromEntityId' && key !== 'toEntityId',
  )

  const x = Math.min(Math.max(at.x - POPOVER_WIDTH / 2, 8), window.innerWidth - POPOVER_WIDTH - 8)
  const y = Math.min(at.y + 10, window.innerHeight - 220)

  const endpointLink = (entity: EntityInstance | undefined, fallbackId: string) => (
    <button
      type="button"
      disabled={entity === undefined}
      className="inline-flex min-w-0 items-center gap-1 truncate text-[12.5px] font-medium hover:underline disabled:no-underline"
      onClick={() => {
        if (entity === undefined) return
        onClose()
        void navigate(`/w/${lensKey}/e/${entity._entityTypeKey}/${entity._id}`)
      }}
    >
      <span className="truncate">
        {entity !== undefined ? displayLabel(entity) : fallbackId.slice(0, 8)}
      </span>
      {entity !== undefined && (
        <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
      )}
    </button>
  )

  return (
    <div
      ref={ref}
      className="fixed z-50 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
      style={{ left: x, top: y, width: POPOVER_WIDTH }}
      role="dialog"
      aria-label="Relation details"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {relation._relationTypeKey}
        </span>
        <span className="truncate text-[12px] text-muted-foreground">
          {relationType?.displayName}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        {endpointLink(sourceEntity, relation.fromEntityId)}
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
        {endpointLink(targetEntity, relation.toEntityId)}
      </div>

      {props.length > 0 && (
        <dl className="mt-2 space-y-0.5 border-t pt-2">
          {props.map(([key, value]) => {
            const dataType = relationType?.properties.find((p) => p.key === key)?.dataType
            return (
              <div key={key} className="flex items-baseline gap-2 text-[12px]">
                <dt className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {key}
                </dt>
                <dd className="min-w-0 truncate">
                  {formatValue(dataType ?? 'string', value) ?? '—'}
                </dd>
              </div>
            )
          })}
        </dl>
      )}

      <div className="mt-2.5 flex justify-end border-t pt-2">
        <Button
          variant="destructive"
          size="xs"
          disabled={deleteMutation.isPending}
          onClick={() => setConfirming(true)}
        >
          {deleteMutation.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Trash2 className="size-3" />
          )}
          Delete relation
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this relation?</AlertDialogTitle>
            <AlertDialogDescription>
              The {relationType?.displayName ?? relation._relationTypeKey} relation is
              removed permanently. Both entities are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                deleteMutation.mutate()
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
