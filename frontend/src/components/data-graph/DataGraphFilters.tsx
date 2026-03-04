import { useState } from 'react';
import type { RuntimeEntityType, RuntimeRelationType, RuntimePropertyDef } from '../../types/runtime';

type NumericOp = '=' | '>=' | '<=';

export interface PropertyFilter {
  value: string;
  op?: NumericOp; // only for integer/float
}

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
  propertyFilters: Record<string, Record<string, PropertyFilter>>;
  onPropertyFilterChange: (entityTypeKey: string, propertyKey: string, filter: PropertyFilter) => void;
  onClearPropertyFilters: () => void;
  typeTotals: Map<string, number>;
  loadedCounts: Map<string, number>;
  typeLoading: Set<string>;
  relationTypeTotals: Map<string, number>;
}

function formatCount(loaded: number | undefined, total: number | undefined): string {
  if (loaded == null && total == null) return '';
  const l = loaded ?? 0;
  if (total != null) return `${l}/${total.toLocaleString()}`;
  return `${l}`;
}

function renderFilterInput(
  typeKey: string,
  prop: RuntimePropertyDef,
  filter: PropertyFilter | undefined,
  onChange: (entityTypeKey: string, propertyKey: string, filter: PropertyFilter) => void,
) {
  const dt = prop.dataType;

  if (dt === 'boolean') {
    return (
      <select
        value={filter?.value ?? ''}
        onChange={(e) => onChange(typeKey, prop.key, { value: e.target.value })}
        className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        <option value="">Any</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  if (dt === 'integer' || dt === 'float') {
    const op = filter?.op ?? '=';
    return (
      <div className="flex gap-1">
        <select
          value={op}
          onChange={(e) => onChange(typeKey, prop.key, { value: filter?.value ?? '', op: e.target.value as NumericOp })}
          className="w-14 px-1 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <option value="=">=</option>
          <option value=">=">&ge;</option>
          <option value="<=">&le;</option>
        </select>
        <input
          type="number"
          step={dt === 'float' ? 'any' : '1'}
          value={filter?.value ?? ''}
          onChange={(e) => onChange(typeKey, prop.key, { value: e.target.value, op })}
          placeholder={prop.displayName}
          className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>
    );
  }

  // string, date, datetime — text input with contains
  return (
    <input
      type="text"
      value={filter?.value ?? ''}
      onChange={(e) => onChange(typeKey, prop.key, { value: e.target.value })}
      placeholder={`Filter ${prop.displayName}...`}
      className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
    />
  );
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
  typeTotals,
  loadedCounts,
  typeLoading,
  relationTypeTotals,
}: Props) {
  const [showPropertyFilters, setShowPropertyFilters] = useState(false);

  // Build grouped properties from visible entity types (each type renders ALL its properties independently)
  const groupedProperties: { typeKey: string; displayName: string; properties: RuntimePropertyDef[] }[] = [];

  for (const et of entityTypes) {
    if (!visibleEntityTypes.has(et.key)) continue;
    if (et.properties.length > 0) {
      groupedProperties.push({ typeKey: et.key, displayName: et.displayName, properties: et.properties });
    }
  }

  const activeFilterCount = Object.values(propertyFilters).reduce(
    (count, typeFilters) => count + Object.values(typeFilters).filter((f) => f.value.length > 0).length,
    0,
  );

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 space-y-2 text-sm">
      {/* Entity type filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-gray-500 font-medium w-24 shrink-0">Entity Types:</span>
        {entityTypes.map((et) => {
          const isOn = visibleEntityTypes.has(et.key);
          const isLoading = typeLoading.has(et.key);
          const badge = isOn ? formatCount(loadedCounts.get(et.key), typeTotals.get(et.key)) : '';
          return (
            <button
              key={et.key}
              onClick={() => onToggleEntityType(et.key)}
              disabled={isLoading}
              className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1 ${
                isOn
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-500'
              } ${isLoading ? 'opacity-60' : ''}`}
            >
              {isLoading && (
                <span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin inline-block" />
              )}
              {et.displayName}
              {badge && <span className="text-[10px] opacity-75">({badge})</span>}
            </button>
          );
        })}
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

      {/* Property filter toggle */}
      {groupedProperties.length > 0 && (
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
      )}

      {/* Property filter inputs grouped by entity type */}
      {showPropertyFilters && groupedProperties.length > 0 && (
        <div className="space-y-3 pt-1">
          {groupedProperties.map((group) => (
            <div key={group.typeKey}>
              <div className="text-xs font-medium text-gray-500 mb-1">{group.displayName}</div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {group.properties.map((prop) => (
                  <div key={prop.key}>
                    <label className="text-xs text-gray-500 block mb-0.5">
                      {prop.displayName}
                      <span className="text-gray-300 ml-1">({prop.dataType})</span>
                    </label>
                    {renderFilterInput(group.typeKey, prop, propertyFilters[group.typeKey]?.[prop.key], onPropertyFilterChange)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
