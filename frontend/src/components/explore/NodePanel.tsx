import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Pin,
  PinOff,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import * as runtime from '@/api/runtime'
import type {
  EntityInstance,
  Neighbor,
  NeighborDirection,
  RelationInstance,
  SchemaEntityType,
  SchemaRelationType,
} from '@/api/types'
import { DocumentBadge } from '@/components/DocumentBadge'
import {
  DocumentViewerDialog,
  type DocumentViewerTarget,
} from '@/components/DocumentViewerDialog'
import { TypeChip } from '@/components/TypeChip'
import { AddRelationDialog } from '@/components/entity/AddRelationDialog'
import { useNeighborCounts } from '@/components/entity/useNeighborCounts'
import { formatValue } from '@/components/schema/propertyDraft'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { displayLabel } from '@/lib/displayLabel'
import { isDocumentStub } from '@/lib/documents'
import type { EntityFlowNode } from './workingSet'

const EXPAND_PAGE = 10
const MAX_SUMMARY_PROPS = 6

function directionOf(
  relationType: SchemaRelationType,
  typeKey: string,
): NeighborDirection {
  const out = relationType.fromEntityTypeKey === typeKey
  const inc = relationType.toEntityTypeKey === typeKey
  return out && inc ? 'both' : out ? 'outgoing' : 'incoming'
}

interface NodePanelProps {
  lensKey: string
  node: EntityFlowNode
  entityTypes: readonly SchemaEntityType[]
  relationTypes: readonly SchemaRelationType[]
  /** Add fetched neighbors (nodes + edges) to the canvas near this node. */
  onExpand: (neighbors: Neighbor[]) => void
  /** A relation (+ possibly new target entity) was created via the dialog. */
  onRelationCreated: (relation: RelationInstance, target: EntityInstance) => void
  onTogglePin: () => void
  /** Remove this node from the canvas (the entity itself is untouched). */
  onRemove: () => void
  /** Deselect the node (closes the panel). */
  onDeselect: () => void
}

/**
 * Right side panel for the selected node: entity summary, click-to-read
 * document properties (opens `DocumentViewerDialog`), per-relation-type
 * expand rows (exact counts + direction indicators; clicking a row pulls the
 * first 10 neighbors onto the canvas, "Show 10 more" bumps the limit), plus
 * open-detail / pin / remove-from-canvas / add-connected-entity actions.
 */
export function NodePanel({
  lensKey,
  node,
  entityTypes,
  relationTypes,
  onExpand,
  onRelationCreated,
  onTogglePin,
  onRemove,
  onDeselect,
}: NodePanelProps) {
  const entity = node.data.entity
  const typeKey = entity._entityTypeKey
  const entityType = entityTypes.find((t) => t.key === typeKey)
  const label = displayLabel(entity)

  const applicable = useMemo(
    () =>
      relationTypes.filter(
        (rt) => rt.fromEntityTypeKey === typeKey || rt.toEntityTypeKey === typeKey,
      ),
    [relationTypes, typeKey],
  )
  const counts = useNeighborCounts(lensKey, entity, applicable)

  const [fetched, setFetched] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState<string | null>(null)
  const [addRelationOpen, setAddRelationOpen] = useState(false)
  const [docTarget, setDocTarget] = useState<DocumentViewerTarget | null>(null)

  const expand = async (rt: SchemaRelationType) => {
    if (loading !== null) return
    const limit = Math.min((fetched[rt.key] ?? 0) + EXPAND_PAGE, 200)
    setLoading(rt.key)
    try {
      const res = await runtime.getNeighbors(lensKey, typeKey, entity._id, {
        relationTypeKey: rt.key,
        direction: directionOf(rt, typeKey),
        limit,
      })
      onExpand(res.neighbors)
      setFetched((prev) => ({ ...prev, [rt.key]: limit }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load neighbors')
    } finally {
      setLoading(null)
    }
  }

  // Documents get their own click-to-read section, so keep them out of the
  // scalar summary (where a stub would only render as a size string).
  const summaryProps = (entityType?.properties ?? [])
    .filter((p) => p.dataType !== 'document')
    .map((p) => ({ property: p, value: formatValue(p.dataType, entity[p.key]) }))
    .filter((p) => p.value !== null)
    .slice(0, MAX_SUMMARY_PROPS)

  const documentProps = (entityType?.properties ?? []).filter(
    (p) => p.dataType === 'document' && isDocumentStub(entity[p.key]),
  )

  const typeNameOf = (key: string) =>
    entityTypes.find((t) => t.key === key)?.displayName ?? key

  return (
    <aside className="absolute top-3 right-3 bottom-3 z-10 flex w-80 flex-col overflow-hidden rounded-xl border bg-card/95 shadow-lg backdrop-blur-sm">
      <header className="border-b px-4 pt-3 pb-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold" title={label}>
              {label}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <TypeChip
                typeKey={typeKey}
                displayName={entityType?.displayName ?? typeKey}
                size="sm"
              />
              {node.data.pinned && (
                <Badge variant="secondary" className="gap-1 text-[10.5px]">
                  <Pin className="size-2.5" /> pinned
                </Badge>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon-xs" aria-label="Deselect" onClick={onDeselect}>
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="mt-2.5 flex items-center gap-1">
          <Button variant="outline" size="xs" asChild>
            <Link to={`/w/${lensKey}/e/${typeKey}/${entity._id}`}>
              <ExternalLink className="size-3" /> Detail
            </Link>
          </Button>
          <Button variant="outline" size="xs" onClick={onTogglePin}>
            {node.data.pinned ? (
              <>
                <PinOff className="size-3" /> Unpin
              </>
            ) : (
              <>
                <Pin className="size-3" /> Pin
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="xs"
            disabled={applicable.length === 0}
            onClick={() => setAddRelationOpen(true)}
          >
            <Link2 className="size-3" /> Connect
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto text-muted-foreground"
                onClick={onRemove}
              >
                <X className="size-3" /> Remove
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove from canvas — the entity is kept</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {summaryProps.length > 0 && (
          <dl className="space-y-1 px-4 py-3">
            {summaryProps.map(({ property, value }) => (
              <div key={property.key} className="flex items-baseline gap-2 text-[12.5px]">
                <dt className="w-24 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                  {property.key}
                </dt>
                <dd className="min-w-0 flex-1 truncate" title={value ?? undefined}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {summaryProps.length > 0 && <Separator />}

        {documentProps.length > 0 && (
          <>
            <div className="px-4 py-3">
              <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Documents
              </h3>
              <ul className="space-y-0.5">
                {documentProps.map((p) => {
                  const stub = entity[p.key]
                  if (!isDocumentStub(stub)) return null
                  return (
                    <li key={p.key}>
                      <button
                        type="button"
                        onClick={() =>
                          setDocTarget({
                            entityTypeKey: typeKey,
                            entityId: entity._id,
                            entityLabel: label,
                            property: p,
                            length: stub.length,
                          })
                        }
                        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-muted/60"
                        aria-label={`Read ${p.displayName}`}
                      >
                        <FileText className="size-3 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {p.displayName}
                        </span>
                        <DocumentBadge length={stub.length} />
                      </button>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Click a document to read it as Markdown.
              </p>
            </div>
            <Separator />
          </>
        )}

        <div className="px-4 py-3">
          <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Relations
          </h3>
          {applicable.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              No relation types apply to {entityType?.displayName ?? typeKey}.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {applicable.map((rt) => {
                const direction = directionOf(rt, typeKey)
                const DirectionIcon =
                  direction === 'both'
                    ? ArrowLeftRight
                    : direction === 'outgoing'
                      ? ArrowRight
                      : ArrowLeft
                const otherTypeKey =
                  direction === 'incoming' ? rt.fromEntityTypeKey : rt.toEntityTypeKey
                const count = counts.data?.[rt.key]
                const fetchedLimit = fetched[rt.key]
                const isLoading = loading === rt.key
                const exhausted =
                  count !== undefined && fetchedLimit !== undefined && fetchedLimit >= count
                return (
                  <li key={rt.key}>
                    <button
                      type="button"
                      disabled={isLoading || count === 0 || exhausted}
                      onClick={() => void expand(rt)}
                      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DirectionIcon className="size-3 shrink-0 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          {direction === 'both'
                            ? 'Both directions'
                            : direction === 'outgoing'
                              ? `To ${typeNameOf(otherTypeKey)}`
                              : `From ${typeNameOf(otherTypeKey)}`}
                        </TooltipContent>
                      </Tooltip>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{rt.displayName}</span>
                        <span className="ml-1.5 text-muted-foreground">
                          {typeNameOf(otherTypeKey)}
                        </span>
                      </span>
                      {isLoading ? (
                        <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <Badge variant="secondary" className="font-mono text-[10.5px]">
                          {count ?? '…'}
                        </Badge>
                      )}
                    </button>
                    {fetchedLimit !== undefined && !exhausted && count !== undefined && (
                      <div className="pb-1 pl-7">
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-muted-foreground"
                          disabled={isLoading}
                          onClick={() => void expand(rt)}
                        >
                          Show {Math.min(count - fetchedLimit, EXPAND_PAGE)} more
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Click a relation to pull its neighbors onto the canvas.
          </p>
        </div>
      </div>

      <DocumentViewerDialog
        lensKey={lensKey}
        target={docTarget}
        onClose={() => setDocTarget(null)}
      />

      <AddRelationDialog
        lensKey={lensKey}
        entity={entity}
        entityLabel={label}
        relationTypes={applicable}
        entityTypes={entityTypes}
        open={addRelationOpen}
        onOpenChange={setAddRelationOpen}
        onCreated={onRelationCreated}
      />
    </aside>
  )
}
