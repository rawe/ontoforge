import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import type { RuntimeEntityType, EntityInstance, RuntimePropertyDef } from '../../types/runtime';
import type { PropertyFilter } from './DataGraphFilters';
import type { ListEntityParams } from '../../api/runtimeClient';
import * as runtimeApi from '../../api/runtimeClient';
import { useFeatures } from '../../hooks/useFeatures';
import { getDisplayLabel } from '../../lib/displayLabel';
import { PER_TYPE_LIMIT } from '../../lib/dataGraphConstants';

const PAGE_SIZE = 20;

interface Props {
  ontologyKey: string;
  entityTypes: RuntimeEntityType[];
  workingSetIds: Set<string>;
  onAddEntities: (entities: EntityInstance[]) => void;
  onClose: () => void;
}

type SearchMode = 'browse' | 'semantic';
type NumericOp = '=' | '>=' | '<=';

// Build API filter params from PropertyFilter records
function buildApiFilters(
  entityType: RuntimeEntityType,
  filters: Record<string, PropertyFilter>,
): Record<string, string> {
  const apiFilters: Record<string, string> = {};
  for (const [key, filter] of Object.entries(filters)) {
    if (!filter.value) continue;
    const propDef = entityType.properties.find((p) => p.key === key);
    if (!propDef) continue;

    const dt = propDef.dataType;
    if (dt === 'string' || dt === 'date' || dt === 'datetime') {
      apiFilters[`${key}__contains`] = filter.value;
    } else if (dt === 'integer' || dt === 'float') {
      const op = filter.op ?? '=';
      if (op === '>=') apiFilters[`${key}__gte`] = filter.value;
      else if (op === '<=') apiFilters[`${key}__lte`] = filter.value;
      else apiFilters[key] = filter.value;
    } else if (dt === 'boolean') {
      apiFilters[key] = filter.value;
    }
  }
  return apiFilters;
}

function FilterInput({
  prop,
  filter,
  onChange,
}: {
  prop: RuntimePropertyDef;
  filter: PropertyFilter | undefined;
  onChange: (filter: PropertyFilter) => void;
}) {
  const dt = prop.dataType;

  if (dt === 'boolean') {
    return (
      <select
        value={filter?.value ?? ''}
        onChange={(e) => onChange({ value: e.target.value })}
        className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        <option value="">Any</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  if (dt === 'integer' || dt === 'float') {
    const op = (filter?.op ?? '=') as NumericOp;
    return (
      <div className="flex gap-1">
        <select
          value={op}
          onChange={(e) => onChange({ value: filter?.value ?? '', op: e.target.value as NumericOp })}
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
          onChange={(e) => onChange({ value: e.target.value, op })}
          placeholder={prop.displayName}
          className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>
    );
  }

  return (
    <input
      type="text"
      value={filter?.value ?? ''}
      onChange={(e) => onChange({ value: e.target.value })}
      placeholder={`Filter ${prop.displayName}...`}
      className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
    />
  );
}

export default function AddEntityPanel({ ontologyKey, entityTypes, workingSetIds, onAddEntities, onClose }: Props) {
  const { data: features } = useFeatures();
  const [selectedType, setSelectedType] = useState<string>(entityTypes[0]?.key ?? '');
  const [searchMode, setSearchMode] = useState<SearchMode>('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<EntityInstance[]>([]);
  const [scores, setScores] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  // Property filter state (per-type, reset on type change)
  const [propertyFilters, setPropertyFilters] = useState<Record<string, PropertyFilter>>({});
  const [showFilters, setShowFilters] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedEntityType = entityTypes.find((et) => et.key === selectedType);
  const activeFilterCount = Object.values(propertyFilters).filter((f) => f.value.length > 0).length;

  const doSearch = useCallback(async (
    typeKey: string,
    query: string,
    pageNum: number,
    mode: SearchMode,
    filters: Record<string, PropertyFilter>,
  ) => {
    if (!typeKey) return;
    setLoading(true);
    try {
      const et = entityTypes.find((t) => t.key === typeKey);
      const apiFilters = et ? buildApiFilters(et, filters) : {};
      const hasFilters = Object.keys(apiFilters).length > 0;

      if (mode === 'semantic' && features?.semanticSearch && query.trim()) {
        const res = await runtimeApi.semanticSearch(ontologyKey, {
          q: query,
          type: typeKey,
          limit: PAGE_SIZE,
          ...(hasFilters ? { filters: apiFilters } : {}),
        });
        setResults(res.results.map((r) => r.entity));
        setScores(new Map(res.results.map((r) => [r.entity._id, r.score])));
        setTotal(res.total);
      } else {
        const params: ListEntityParams = {
          limit: PAGE_SIZE,
          offset: pageNum * PAGE_SIZE,
          q: query.trim() || undefined,
        };
        if (hasFilters) params.filters = apiFilters;

        const res = await runtimeApi.listEntities(ontologyKey, typeKey, params);
        setResults(res.items);
        setScores(new Map());
        setTotal(res.total);
      }
    } catch {
      toast.error('Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [ontologyKey, features, entityTypes]);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setPage(0);
    if (searchMode === 'semantic') return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(selectedType, val, 0, searchMode, propertyFilters), 300);
  };

  const handleSemanticSearch = () => {
    if (searchQuery.trim()) {
      doSearch(selectedType, searchQuery, 0, 'semantic', propertyFilters);
    }
  };

  const handleTypeChange = (key: string) => {
    setSelectedType(key);
    setPage(0);
    setSelectedIds(new Set());
    setPropertyFilters({});
    doSearch(key, searchQuery, 0, searchMode, {});
  };

  const handleModeChange = (mode: SearchMode) => {
    setSearchMode(mode);
    setPage(0);
    if (mode === 'browse') {
      doSearch(selectedType, searchQuery, 0, mode, propertyFilters);
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    doSearch(selectedType, searchQuery, newPage, searchMode, propertyFilters);
  };

  const handleFilterChange = (propKey: string, filter: PropertyFilter) => {
    const newFilters = { ...propertyFilters, [propKey]: filter };
    setPropertyFilters(newFilters);
    setPage(0);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(selectedType, searchQuery, 0, searchMode, newFilters), 300);
  };

  const handleClearFilters = () => {
    setPropertyFilters({});
    setPage(0);
    doSearch(selectedType, searchQuery, 0, searchMode, {});
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    const newIds = results.filter((e) => !workingSetIds.has(e._id)).map((e) => e._id);
    setSelectedIds(new Set(newIds));
  };

  const handleAddSelected = () => {
    const toAdd = results.filter((e) => selectedIds.has(e._id));
    if (toAdd.length === 0) return;
    onAddEntities(toAdd);
    setSelectedIds(new Set());
    toast.success(`Added ${toAdd.length} entities to canvas`);
  };

  // Bulk-add: load up to PER_TYPE_LIMIT recent entities of the selected type
  const handleLoadRecent = async () => {
    if (!selectedType) return;
    setLoading(true);
    try {
      const et = entityTypes.find((t) => t.key === selectedType);
      const apiFilters = et ? buildApiFilters(et, propertyFilters) : {};
      const params: ListEntityParams = {
        limit: PER_TYPE_LIMIT,
        sort: '_createdAt',
        order: 'desc',
      };
      if (Object.keys(apiFilters).length > 0) params.filters = apiFilters;

      const res = await runtimeApi.listEntities(ontologyKey, selectedType, params);
      const newItems = res.items.filter((e) => !workingSetIds.has(e._id));
      if (newItems.length > 0) {
        onAddEntities(newItems);
        toast.success(`Added ${newItems.length} entities to canvas`);
      } else if (res.items.length > 0) {
        toast.info('All matching entities already on canvas');
      } else {
        toast.info('No matching entities found');
      }
    } catch {
      toast.error('Failed to load entities');
    } finally {
      setLoading(false);
    }
  };

  // Load initial results when panel opens
  const initialLoaded = useRef(false);
  if (!initialLoaded.current && selectedType) {
    initialLoaded.current = true;
    doSearch(selectedType, '', 0, 'browse', {});
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const filterableProps = selectedEntityType?.properties ?? [];

  return (
    <div className="w-96 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Add Entities</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
      </div>

      {/* Controls */}
      <div className="px-4 py-2 border-b border-gray-100 space-y-2">
        {/* Type picker */}
        <select
          value={selectedType}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {entityTypes.map((et) => (
            <option key={et.key} value={et.key}>{et.displayName}</option>
          ))}
        </select>

        {/* Mode tabs */}
        <div className="flex gap-1">
          <button
            onClick={() => handleModeChange('browse')}
            className={`px-2 py-1 text-xs rounded ${searchMode === 'browse' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            Browse
          </button>
          {features?.semanticSearch && (
            <button
              onClick={() => handleModeChange('semantic')}
              className={`px-2 py-1 text-xs rounded ${searchMode === 'semantic' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              Semantic Search
            </button>
          )}
        </div>

        {/* Search input */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (searchMode === 'semantic' && e.key === 'Enter') handleSemanticSearch();
            }}
            placeholder={searchMode === 'semantic' ? 'Describe what you\'re looking for...' : 'Search by text...'}
            className="w-full px-3 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              &times;
            </button>
          )}
        </div>

        {/* Semantic search button */}
        {searchMode === 'semantic' && (
          <button
            onClick={handleSemanticSearch}
            disabled={!searchQuery.trim() || loading}
            className="w-full px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        )}

        {/* Property filters (collapsible) */}
        {filterableProps.length > 0 && (
          <div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="text-xs text-gray-600 hover:text-gray-800 flex items-center gap-1"
            >
              <svg className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Property Filters
              {activeFilterCount > 0 && (
                <span className="bg-blue-100 text-blue-700 text-[10px] font-medium px-1.5 rounded-full">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {showFilters && (
              <div className="mt-2 space-y-2">
                {filterableProps.map((prop) => (
                  <div key={prop.key}>
                    <label className="text-[10px] text-gray-500 block mb-0.5">
                      {prop.displayName}
                      <span className="text-gray-300 ml-1">({prop.dataType})</span>
                    </label>
                    <FilterInput
                      prop={prop}
                      filter={propertyFilters[prop.key]}
                      onChange={(f) => handleFilterChange(prop.key, f)}
                    />
                  </div>
                ))}
                {activeFilterCount > 0 && (
                  <button
                    onClick={handleClearFilters}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Load Recent shortcut */}
        <button
          onClick={handleLoadRecent}
          disabled={loading}
          className="w-full px-3 py-1.5 text-xs font-medium border border-blue-200 text-blue-700 bg-blue-50 rounded hover:bg-blue-100 disabled:opacity-50"
        >
          {loading ? 'Loading...' : `Add up to ${PER_TYPE_LIMIT} Recent${activeFilterCount > 0 ? ' (filtered)' : ''}`}
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <p className="text-center py-8 text-sm text-gray-400">
            {searchMode === 'semantic' && !searchQuery.trim() ? 'Enter a query and click Search' : 'No results'}
          </p>
        ) : (
          <div>
            {results.map((entity) => {
              const inSet = workingSetIds.has(entity._id);
              const isSelected = selectedIds.has(entity._id);
              const score = scores.get(entity._id);
              return (
                <div
                  key={entity._id}
                  className={`flex items-center gap-2 px-4 py-2 border-b border-gray-50 hover:bg-gray-50 ${inSet ? 'opacity-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={inSet}
                    onChange={() => toggleSelect(entity._id)}
                    className="h-3.5 w-3.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 truncate">{getDisplayLabel(entity)}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{entity._id.slice(0, 12)}...</div>
                  </div>
                  {score != null && (
                    <span className="text-[10px] text-emerald-600 font-mono shrink-0">
                      {(score * 100).toFixed(0)}%
                    </span>
                  )}
                  {inSet && (
                    <span className="text-[10px] text-gray-400">on canvas</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-4 py-2 space-y-2">
        {/* Pagination (browse mode only) */}
        {totalPages > 1 && searchMode === 'browse' && (
          <div className="flex items-center justify-between text-xs text-gray-500">
            <button
              onClick={() => handlePageChange(page - 1)}
              disabled={page === 0}
              className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30"
            >
              Prev
            </button>
            <span>{page + 1} / {totalPages} ({total} total)</span>
            <button
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleSelectAll}
            disabled={results.length === 0}
            className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-30"
          >
            Select All
          </button>
          <button
            onClick={handleAddSelected}
            disabled={selectedIds.size === 0}
            className="flex-1 px-2 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            Add Selected ({selectedIds.size})
          </button>
        </div>
      </div>
    </div>
  );
}
