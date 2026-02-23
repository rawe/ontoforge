import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { EntityType } from '../../types/models';

interface EntityTypeNodeData {
  entityType: EntityType;
  propertyCount: number;
  [key: string]: unknown;
}

export default function EntityTypeNode({ data }: NodeProps) {
  const { entityType, propertyCount } = data as unknown as EntityTypeNodeData;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-blue-500 px-3 py-2 min-w-[180px]">
      <Handle type="target" position={Position.Left} className="!bg-blue-400 !w-2 !h-2" />
      <div className="font-semibold text-sm text-gray-900 truncate">{entityType.displayName}</div>
      <div className="text-xs text-gray-400 font-mono truncate">{entityType.key}</div>
      <div className="text-xs text-gray-500 mt-1">
        {propertyCount} {propertyCount === 1 ? 'property' : 'properties'}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-blue-400 !w-2 !h-2" />
    </div>
  );
}
