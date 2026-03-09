import type { RuntimeEntityType, RuntimeRelationType } from '../../types/runtime';

// Kept exported for use by AddEntityPanel
type NumericOp = '=' | '>=' | '<=';

export interface PropertyFilter {
  value: string;
  op?: NumericOp;
}

interface Props {
  entityTypes: RuntimeEntityType[];
  relationTypes: RuntimeRelationType[];
  visibleEntityTypes: Set<string>;
  visibleRelationTypes: Set<string>;
  canvasCounts: Map<string, number>;
  onToggleEntityType: (key: string) => void;
  onToggleRelationType: (key: string) => void;
  onRemoveType: (key: string) => void;
  onShowAllEntities: () => void;
  onHideAllEntities: () => void;
  onShowAllRelations: () => void;
  onHideAllRelations: () => void;
  relationTypeTotals: Map<string, number>;
}

export default function DataGraphFilters({
  entityTypes,
  relationTypes,
  visibleEntityTypes,
  visibleRelationTypes,
  canvasCounts,
  onToggleEntityType,
  onToggleRelationType,
  onRemoveType,
  onShowAllEntities,
  onHideAllEntities,
  onShowAllRelations,
  onHideAllRelations,
  relationTypeTotals,
}: Props) {
  const hasAnyOnCanvas = [...canvasCounts.values()].some((c) => c > 0);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 space-y-2 text-sm">
      {/* Entity type visibility toggles */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-gray-500 font-medium w-24 shrink-0">On Canvas:</span>
        {entityTypes.map((et) => {
          const count = canvasCounts.get(et.key) ?? 0;
          const isVisible = visibleEntityTypes.has(et.key);
          return (
            <div key={et.key} className="inline-flex items-center group">
              <button
                onClick={() => count > 0 ? onToggleEntityType(et.key) : undefined}
                disabled={count === 0}
                className={`px-2 py-0.5 rounded-l-full text-xs font-medium transition-colors inline-flex items-center gap-1 ${
                  count > 0 && isVisible
                    ? 'bg-blue-100 text-blue-700'
                    : count > 0
                    ? 'bg-gray-200 text-gray-600'
                    : 'bg-gray-50 text-gray-400 cursor-default'
                } ${count > 0 ? 'rounded-r-full group-hover:rounded-r-none' : 'rounded-r-full'}`}
              >
                {et.displayName}
                {count > 0 && <span className="text-[10px] opacity-75">({count})</span>}
              </button>
              {count > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveType(et.key); }}
                  className="h-[22px] px-1 rounded-r-full bg-gray-200 text-gray-400 hover:text-red-600 hover:bg-red-50 text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center"
                  title={`Remove all ${et.displayName} from canvas`}
                >
                  &times;
                </button>
              )}
            </div>
          );
        })}
        {hasAnyOnCanvas && (
          <>
            <button onClick={onShowAllEntities} className="text-xs text-blue-600 hover:underline ml-1">
              Show All
            </button>
            <button onClick={onHideAllEntities} className="text-xs text-blue-600 hover:underline">
              Hide All
            </button>
          </>
        )}
      </div>

      {/* Relation type toggles */}
      {relationTypes.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-gray-500 font-medium w-24 shrink-0">Relations:</span>
          {relationTypes.map((rt) => {
            const isOn = visibleRelationTypes.has(rt.key);
            const total = relationTypeTotals.get(rt.key);
            return (
              <button
                key={rt.key}
                onClick={() => onToggleRelationType(rt.key)}
                className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1 ${
                  isOn
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {rt.displayName}
                {isOn && total != null && <span className="text-[10px] opacity-75">({total.toLocaleString()})</span>}
              </button>
            );
          })}
          <button onClick={onShowAllRelations} className="text-xs text-blue-600 hover:underline ml-1">
            All
          </button>
          <button onClick={onHideAllRelations} className="text-xs text-blue-600 hover:underline">
            None
          </button>
        </div>
      )}
    </div>
  );
}
