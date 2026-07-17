import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import type { RelationFlowEdge } from './workingSet'

/**
 * Relation edge: subtle stroke + arrowhead (markerEnd set on the edge object)
 * and a small mono relation-type label. Self-referential relations render as
 * a loop arcing over the node instead of the degenerate bezier.
 */
function RelationEdgeInner({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<RelationFlowEdge>) {
  let path: string
  let labelX: number
  let labelY: number

  if (source === target) {
    // Loop from the right handle up and around to the left handle.
    const rise = 56
    path = `M ${sourceX} ${sourceY} C ${sourceX + 70} ${sourceY - rise}, ${
      targetX - 70
    } ${targetY - rise}, ${targetX} ${targetY}`
    labelX = (sourceX + targetX) / 2
    labelY = sourceY - rise + 8
  } else {
    ;[path, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    })
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke: 'var(--border)', strokeWidth: 1.5 }}
      />
      <EdgeLabelRenderer>
        <div
          className="pointer-events-none absolute rounded bg-background/85 px-1 font-mono text-[9.5px] leading-4 text-muted-foreground"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {data?.relation._relationTypeKey}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const RelationEdge = memo(RelationEdgeInner)
