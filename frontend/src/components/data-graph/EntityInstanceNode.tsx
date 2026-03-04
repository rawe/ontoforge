import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { EntityInstance } from '../../types/runtime';

// Color palette for entity type badges
const TYPE_COLORS: Record<number, { bg: string; border: string; text: string }> = {
  0: { bg: 'bg-blue-50', border: 'border-l-blue-500', text: 'text-blue-700' },
  1: { bg: 'bg-emerald-50', border: 'border-l-emerald-500', text: 'text-emerald-700' },
  2: { bg: 'bg-violet-50', border: 'border-l-violet-500', text: 'text-violet-700' },
  3: { bg: 'bg-amber-50', border: 'border-l-amber-500', text: 'text-amber-700' },
  4: { bg: 'bg-rose-50', border: 'border-l-rose-500', text: 'text-rose-700' },
  5: { bg: 'bg-cyan-50', border: 'border-l-cyan-500', text: 'text-cyan-700' },
  6: { bg: 'bg-orange-50', border: 'border-l-orange-500', text: 'text-orange-700' },
  7: { bg: 'bg-indigo-50', border: 'border-l-indigo-500', text: 'text-indigo-700' },
};

export interface EntityInstanceNodeData {
  entity: EntityInstance;
  label: string;
  typeDisplayName: string;
  colorIndex: number;
  selected?: boolean;
  [key: string]: unknown;
}

export default function EntityInstanceNode({ data }: NodeProps) {
  const { entity, label, typeDisplayName, colorIndex, selected } = data as unknown as EntityInstanceNodeData;
  const colors = TYPE_COLORS[colorIndex % Object.keys(TYPE_COLORS).length];

  return (
    <div
      className={`bg-white rounded-lg border shadow-sm hover:shadow-md transition-all cursor-pointer border-l-4 ${colors.border} px-3 py-2 min-w-[200px] max-w-[260px] ${
        selected
          ? 'ring-2 ring-blue-500 ring-offset-1 border-blue-400 shadow-md'
          : 'border-gray-200'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-blue-400 !w-2 !h-2" />
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${colors.bg} ${colors.text}`}>
          {typeDisplayName}
        </span>
      </div>
      <div className="font-medium text-sm text-gray-900 truncate">{label}</div>
      <div className="text-[10px] text-gray-400 font-mono truncate">{entity._id.slice(0, 12)}...</div>
      <Handle type="source" position={Position.Right} className="!bg-blue-400 !w-2 !h-2" />
    </div>
  );
}
