import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import type { RelationType } from '../../types/models';

interface RelationTypeEdgeData {
  relationType: RelationType;
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
  const { relationType } = data as unknown as RelationTypeEdgeData;
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
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} className="!stroke-gray-400 hover:!stroke-blue-500" />
      <EdgeLabelRenderer>
        <div
          className="bg-white border border-gray-200 rounded px-2 py-0.5 text-xs text-gray-600 shadow-sm pointer-events-auto cursor-pointer hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 transition-colors"
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
