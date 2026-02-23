import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import type { RelationType } from '../../types/models';

interface RelationTypeEdgeData {
  relationType: RelationType;
  selected?: boolean;
  [key: string]: unknown;
}

export default function RelationTypeEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const { relationType, selected } = data as unknown as RelationTypeEdgeData;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        className={selected ? '!stroke-blue-500' : '!stroke-gray-400 hover:!stroke-blue-500'}
        style={selected ? { strokeWidth: 2.5 } : undefined}
      />
      <EdgeLabelRenderer>
        <div
          className={`rounded px-2 py-0.5 text-xs shadow-sm pointer-events-auto cursor-pointer transition-colors ${
            selected
              ? 'bg-blue-50 text-blue-700 border border-blue-400 ring-1 ring-blue-300'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300'
          }`}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
        >
          {relationType.displayName}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
