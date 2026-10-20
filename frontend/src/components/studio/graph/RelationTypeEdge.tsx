import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react'
import type { ParentEnd } from '@/api/types'
import { cn } from '@/lib/utils'
import { edgeGeometry, type Box, type EdgeShape } from './geometry'
import { NODE_WIDTH } from './layout'

export interface RelationEdgeData extends EdgeShape, Record<string, unknown> {
  label: string
  /** Curve parameter of the label (0.5 = middle), chosen by the canvas to keep labels apart. */
  labelT: number
  /** The dashed edge of a relation type still being named; not selectable. */
  pending?: boolean
  /** Outside the focus set, or not a search match. */
  dim?: boolean
  /** Matches the outline search. */
  match?: boolean
  /** The parent end of a parent relation; null or absent for an ordinary one. */
  parent?: ParentEnd | null
  onSelect?: () => void
}

export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>

export const EDGE_COLOR = 'color-mix(in oklab, var(--foreground) 30%, transparent)'
/** Parent relations and the hierarchy: their edges, the parent-end dot. */
export const PARENT_COLOR = 'var(--tc-violet)'

/** A node's live box, while it is dragged too. */
const boxOf = (n: InternalNode): Box => ({
  x: n.internals.positionAbsolute.x,
  y: n.internals.positionAbsolute.y,
  w: n.measured.width ?? NODE_WIDTH,
  h: n.measured.height ?? 80,
})

/**
 * Relation type edge: floating between the two node boxes (`geometry.ts`),
 * curved apart from parallel relation types, a loop for a self-relation, and
 * the relation key as a label on a solid background. Clicking the label
 * selects the relation type, like clicking the line. A parent relation is
 * violet and thicker, with a dot on its parent end; its arrowhead still
 * points at the target.
 */
function RelationTypeEdgeInner({ id, source, target, data, selected, markerEnd }: EdgeProps<RelationFlowEdge>) {
  const s = useInternalNode(source)
  const t = useInternalNode(target)
  if (s === undefined || t === undefined || data === undefined) return null

  const geo = edgeGeometry(boxOf(s), boxOf(t), source === target, data, data.labelT)
  const pending = data.pending === true
  const parent = data.parent ?? null
  const stroke = selected || pending ? 'var(--primary)' : data.match === true ? 'var(--tc-amber)' : parent !== null ? PARENT_COLOR : EDGE_COLOR
  const opacity = data.dim === true ? 0.12 : 1
  const dot = parent === 'source' ? geo.start : geo.end

  return (
    <>
      <BaseEdge
        id={id}
        path={geo.path}
        markerEnd={markerEnd}
        interactionWidth={18}
        className="of-edge-path"
        style={{
          stroke,
          strokeWidth: (selected ? 2 : 1.5) + (parent !== null ? 1 : 0),
          strokeDasharray: pending ? '5 4' : undefined,
          opacity,
        }}
      />
      {parent !== null && (
        <circle cx={dot.x} cy={dot.y} r={4.5} style={{ fill: stroke, opacity }} pointerEvents="none" />
      )}
      <EdgeLabelRenderer>
        <button
          type="button"
          className={cn(
            'nodrag nopan absolute cursor-pointer rounded border px-1 font-mono text-[10px] leading-4 shadow-xs transition-colors',
            selected
              ? 'z-10 border-primary bg-primary text-primary-foreground'
              : pending
                ? 'cursor-default border-dashed border-primary/60 bg-background text-primary'
                : 'border-border bg-background text-muted-foreground hover:z-10 hover:text-foreground',
            data.match === true && !selected && 'border-(--tc-amber)/70',
            data.dim === true && 'opacity-15',
          )}
          style={{
            transform: `translate(-50%, -50%) translate(${geo.label.x}px, ${geo.label.y}px)`,
            pointerEvents: 'all',
          }}
          onClick={(e) => {
            e.stopPropagation()
            data.onSelect?.()
          }}
        >
          {data.label}
        </button>
      </EdgeLabelRenderer>
    </>
  )
}

export const RelationTypeEdge = memo(RelationTypeEdgeInner)
