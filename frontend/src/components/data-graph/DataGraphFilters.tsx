import { useState } from 'react';
import type { RuntimeEntityType, RuntimeRelationType, RuntimePropertyDef } from '../../types/runtime';

interface Props {
  entityTypes: RuntimeEntityType[];
  relationTypes: RuntimeRelationType[];
  visibleEntityTypes: Set<string>;
  visibleRelationTypes: Set<string>;
  onToggleEntityType: (key: string) => void;
  onToggleRelationType: (key: string) => void;
  onShowAllEntities: () => void;
  onHideAllEntities: () => void;
  onShowAllRelations: () => void;
  onHideAllRelations: () => void;
  propertyFilters: Record<string, string>;
  onPropertyFilterChange: (key: string, value: string) => void;
  onClearPropertyFilters: () => void;
}

export default function DataGraphFilters({
  entityTypes,
  relationTypes,
  visibleEntityTypes,
  visibleRelationTypes,
  onToggleEntityType,
  onToggleRelationType,
  onShowAllEntities,
  onHideAllEntities,
  onShowAllRelations,
  onHideAllRelations,
  propertyFilters,
  onPropertyFilterChange,
  onClearPropertyFilters,
}: Props) {
  const [showPropertyFilters, setShowPropertyFilters] = useState(false);

  // Collect all unique properties from visible entity types
  const allProperties: RuntimePropertyDef[] = [];
  const seen = new Set<string>();
  for (const et of entityTypes) {
    if (!visibleEntityTypes.has(et.key)) continue;
    for (const p of et.properties) {
      if (!seen.has(p.key)) {
        seen.add(p.key);
        allProperties.push(p);
      }
    }
  }

  const activeFilterCount = Object.values(propertyFilters).filter((v) => v.length > 0).length;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 space-y-2 text-sm">
      {/* Entity type filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-gray-500 font-medium w-24 shrink-0">Entity Types:</span>
        {entityTypes.map((et) => (
          <button
            key={et.key}
            onClick={() => onToggleEntityType(et.key)}
            className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
              visibleEntityTypes.has(et.key)
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {et.displayName}
          </button>
        ))}
        <button onClick={onShowAllEntities} className="text-xs text-blue-600 hover:underline ml-1">
          All
        </button>
        <button onClick={onHideAllEntities} className="text-xs text-blue-600 hover:underline">
          None
        </button>
      </div>

      {/* Relation type filters */}
      {relationTypes.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-gray-500 font-medium w-24 shrink-0">Relations:</span>
          {relationTypes.map((rt) => (
            <button
              key={rt.key}
              onClick={() => onToggleRelationType(rt.key)}
              className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                visibleRelationTypes.has(rt.key)
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {rt.displayName}
            </button>
          ))}
          <button onClick={onShowAllRelations} className="text-xs text-blue-600 hover:underline ml-1">
            All
          </button>
          <button onClick={onHideAllRelations} className="text-xs text-blue-600 hover:underline">
            None
          </button>
        </div>
      )}

      {/* Property filter toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowPropertyFilters(!showPropertyFilters)}
          className="text-xs text-gray-600 hover:text-gray-800 flex items-center gap-1"
        >
          <svg className={`w-3 h-3 transition-transform ${showPropertyFilters ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Property Filters
          {activeFilterCount > 0 && (
            <span className="bg-blue-100 text-blue-700 text-[10px] font-medium px-1.5 rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>
        {activeFilterCount > 0 && (
          <button
            onClick={onClearPropertyFilters}
            className="text-xs text-red-500 hover:text-red-700"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Property filter inputs */}
      {showPropertyFilters && allProperties.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 pt-1">
          {allProperties.map((prop) => (
            <div key={prop.key}>
              <label className="text-xs text-gray-500 block mb-0.5">{prop.displayName}</label>
              <input
                type="text"
                value={propertyFilters[prop.key] ?? ''}
                onChange={(e) => onPropertyFilterChange(prop.key, e.target.value)}
                placeholder={`Filter ${prop.displayName}...`}
                className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
