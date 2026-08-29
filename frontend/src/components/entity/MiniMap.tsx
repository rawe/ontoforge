import { ArrowLeft, ArrowLeftRight, ArrowRight, Waypoints } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { EntityInstance, SchemaRelationType } from '@/api/types'
import { Button } from '@/components/ui/button'
import { TypeDot } from '@/components/TypeChip'

interface MiniMapProps {
  lensKey: string
  entity: EntityInstance
  relationTypes: readonly SchemaRelationType[]
  counts: Record<string, number> | undefined
}

/**
 * Compact neighborhood summary: neighbor count per relation type with a CTA
 * to open the entity focused in the Explorer canvas.
 */
export function MiniMap({ lensKey, entity, relationTypes, counts }: MiniMapProps) {
  const myTypeKey = entity._entityTypeKey
  const total =
    counts === undefined
      ? undefined
      : relationTypes.reduce((sum, rt) => sum + (counts[rt.key] ?? 0), 0)

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
        <Waypoints className="size-3.5 text-muted-foreground" />
        <h3 className="text-[13px] font-semibold">Neighborhood</h3>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {total !== undefined ? `${total} total` : '…'}
        </span>
      </header>
      <div className="space-y-1 px-4 py-2.5">
        {relationTypes.length === 0 && (
          <p className="py-2 text-center text-[13px] text-muted-foreground">
            No relation types apply to this entity type.
          </p>
        )}
        {relationTypes.map((rt) => {
          const isOutgoing = rt.fromEntityTypeKey === myTypeKey
          const isIncoming = rt.toEntityTypeKey === myTypeKey
          const Icon =
            isOutgoing && isIncoming ? ArrowLeftRight : isOutgoing ? ArrowRight : ArrowLeft
          const otherKey = isOutgoing ? rt.toEntityTypeKey : rt.fromEntityTypeKey
          return (
            <div key={rt.key} className="flex items-center gap-2 text-[12.5px]">
              <Icon className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{rt.displayName}</span>
              <TypeDot typeKey={otherKey} className="size-1.5" />
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {counts?.[rt.key] ?? '…'}
              </span>
            </div>
          )
        })}
      </div>
      <div className="border-t px-4 py-2">
        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link to={`/w/${lensKey}/explore?focus=${myTypeKey}:${entity._id}`}>
            <Waypoints className="size-3.5" />
            Open in Explorer
          </Link>
        </Button>
      </div>
    </section>
  )
}
