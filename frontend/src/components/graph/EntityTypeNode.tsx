import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { EntityType } from '../../types/models';

interface EntityTypeNodeData {
  entityType: EntityType;
  propertyCount: number;
  selected?: boolean;
  [key: string]: unknown;
}

export default function EntityTypeNode({ data }: NodeProps) {
  const { entityType, propertyCount, selected } = data as unknown as EntityTypeNodeData;

  return (
    <div
      className={`bg-white rounded-lg border shadow-sm hover:shadow-md transition-all cursor-pointer border-l-4 border-l-blue-500 px-3 py-2 min-w-[180px] ${
        selected
          ? 'ring-2 ring-blue-500 ring-offset-1 border-blue-400 shadow-md'
          : 'border-gray-200'
      }`}
    >
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
