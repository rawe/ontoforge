import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import type { RuntimeEntityType, EntityInstance } from '../../types/runtime';
import * as runtimeApi from '../../api/runtimeClient';
import { useFeatures } from '../../hooks/useFeatures';
import { getDisplayLabel } from '../../lib/displayLabel';

interface Props {
  ontologyKey: string;
  entityTypes: RuntimeEntityType[];
  workingSetIds: Set<string>;
  onAddEntities: (entities: EntityInstance[]) => void;
  onClose: () => void;
}

type SearchMode = 'browse' | 'semantic';

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
  const PAGE_SIZE = 20;
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (typeKey: string, query: string, pageNum: number, mode: SearchMode) => {
    if (!typeKey) return;
    setLoading(true);
    try {
      if (mode === 'semantic' && features?.semanticSearch && query.trim()) {
        const res = await runtimeApi.semanticSearch(ontologyKey, {
          q: query,
          type: typeKey,
          limit: PAGE_SIZE,
        });
        setResults(res.results.map((r) => r.entity));
        setScores(new Map(res.results.map((r) => [r.entity._id, r.score])));
        setTotal(res.total);
      } else {
        const res = await runtimeApi.listEntities(ontologyKey, typeKey, {
          limit: PAGE_SIZE,
          offset: pageNum * PAGE_SIZE,
          q: query.trim() || undefined,
        });
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
  }, [ontologyKey, features]);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setPage(0);
    if (searchMode === 'semantic') {
      // In semantic mode, don't auto-search — wait for explicit button click
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(selectedType, val, 0, searchMode), 300);
  };

  const handleSemanticSearch = () => {
    if (searchQuery.trim()) {
      doSearch(selectedType, searchQuery, 0, 'semantic');
    }
  };

  const handleTypeChange = (key: string) => {
    setSelectedType(key);
    setPage(0);
    setSelectedIds(new Set());
    doSearch(key, searchQuery, 0, searchMode);
  };

  const handleModeChange = (mode: SearchMode) => {
    setSearchMode(mode);
    setPage(0);
    if (mode === 'browse') {
      doSearch(selectedType, searchQuery, 0, mode);
    }
    // Don't auto-search when switching to semantic
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    doSearch(selectedType, searchQuery, newPage, searchMode);
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
    toast.success(`Added ${toAdd.length} entities to graph`);
  };

  // Load initial results when panel opens
  const initialLoaded = useRef(false);
  if (!initialLoaded.current && selectedType) {
    initialLoaded.current = true;
    doSearch(selectedType, '', 0, 'browse');
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="w-96 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Add Entities</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
      </div>

      {/* Type picker */}
      <div className="px-4 py-2 border-b border-gray-100 space-y-2">
        <select
          value={selectedType}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {entityTypes.map((et) => (
            <option key={et.key} value={et.key}>{et.displayName}</option>
          ))}
        </select>

        {/* Search mode toggle */}
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
            placeholder={searchMode === 'semantic' ? 'Describe what you\'re looking for...' : 'Search...'}
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

        {/* Explicit search button for semantic mode */}
        {searchMode === 'semantic' && (
          <button
            onClick={handleSemanticSearch}
            disabled={!searchQuery.trim() || loading}
            className="w-full px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        )}
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
                    <span className="text-[10px] text-gray-400">in graph</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer with pagination and add */}
      <div className="border-t border-gray-100 px-4 py-2 space-y-2">
        {/* Pagination */}
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
