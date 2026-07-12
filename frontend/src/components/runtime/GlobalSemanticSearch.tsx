import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import * as runtimeApi from '../../api/runtimeClient';
import type { RuntimeEntityType, SemanticSearchResult } from '../../types/runtime';

const RESULT_LIMIT = 20;

interface GlobalSemanticSearchProps {
  ontologyKey: string;
  entityTypes: RuntimeEntityType[];
}

export default function GlobalSemanticSearch({ ontologyKey, entityTypes }: GlobalSemanticSearchProps) {
  const [searchInput, setSearchInput] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [results, setResults] = useState<SemanticSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const typesByKey = new Map(entityTypes.map((et) => [et.key, et]));

  const handleSearchSubmit = async () => {
    const trimmed = searchInput.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const res = await runtimeApi.semanticSearch(ontologyKey, {
        q: trimmed,
        limit: RESULT_LIMIT,
      });
      setResults(res.results);
      setSubmittedSearch(trimmed);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearchSubmit();
    }
  };

  const clearSearch = () => {
    setSearchInput('');
    setSubmittedSearch('');
    setResults([]);
  };

  return (
    <section className="mb-8">
      <h3 className="text-lg font-semibold text-gray-800 mb-3">Semantic Search</h3>
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-lg">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search across all entity types..."
            className="w-full px-3 py-2 pr-8 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {(searchInput || submittedSearch) && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
              title="Clear search"
            >
              &times;
            </button>
          )}
        </div>
        <button
          onClick={handleSearchSubmit}
          disabled={!searchInput.trim() || loading}
          className="px-4 py-2 bg-gray-100 border border-gray-300 text-sm rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {submittedSearch && !loading && (
        <div className="mt-3">
          <p className="text-xs text-gray-400 mb-2">
            {results.length} result{results.length !== 1 ? 's' : ''} for &ldquo;{submittedSearch}&rdquo;
          </p>
          <ul className="space-y-2">
            {results.map((r) => {
              const entityType = typesByKey.get(r.entity._entityTypeKey);
              return (
                <li
                  key={r.entity._id}
                  className="border border-gray-200 rounded-lg p-3 bg-white shadow-sm flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {entityLabel(r.entity, entityType)}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{entitySummary(r.entity)}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-gray-400" title="Similarity score">
                      {(r.score * 100).toFixed(0)}%
                    </span>
                    <Link
                      to={`/data/${ontologyKey}/entities/${r.entity._entityTypeKey}`}
                      className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded border border-gray-300 hover:bg-gray-200 font-mono"
                    >
                      {entityType?.displayName ?? r.entity._entityTypeKey}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function entityLabel(entity: SemanticSearchResult['entity'], entityType?: RuntimeEntityType): string {
  for (const prop of entityType?.properties ?? []) {
    const value = entity[prop.key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return entity._id;
}

function entitySummary(entity: SemanticSearchResult['entity']): string {
  return Object.entries(entity)
    .filter(([key, value]) => !key.startsWith('_') && value != null && value !== '')
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ');
}
