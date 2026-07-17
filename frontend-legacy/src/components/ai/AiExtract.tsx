import { useState } from 'react';
import { toast } from 'sonner';
import { aiExtract } from '../../api/runtimeClient';
import { useAiState } from '../../hooks/useAiState';

interface AiExtractProps {
  ontologyKey: string;
  entityTypes: { key: string; displayName: string }[];
}

export default function AiExtract({ ontologyKey, entityTypes }: AiExtractProps) {
  const { getState, updateExtract, resetExtract } = useAiState();
  const { text, selectedTypes, create, response, error } = getState(ontologyKey).extract;
  const [loading, setLoading] = useState(false);

  const setText = (t: string) => updateExtract(ontologyKey, { text: t });
  const setCreate = (c: boolean) => updateExtract(ontologyKey, { create: c });

  const toggleType = (key: string) => {
    const next = new Set(selectedTypes);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updateExtract(ontologyKey, { selectedTypes: next });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || loading) return;

    setLoading(true);
    updateExtract(ontologyKey, { error: null, response: null });

    try {
      const types = selectedTypes.size > 0 ? Array.from(selectedTypes) : undefined;
      const res = await aiExtract(ontologyKey, text.trim(), types, create);
      updateExtract(ontologyKey, { response: res });
      if (res.created) {
        toast.success('Extracted data saved to graph');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Extraction failed';
      updateExtract(ontologyKey, { error: msg });
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (loading) return;
    resetExtract(ontologyKey);
  };

  const hasContent = text || response || error;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste unstructured text to extract entities and relations..."
          rows={6}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
          disabled={loading}
        />

        {entityTypes.length > 0 && (
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              Filter entity types (optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {entityTypes.map((et) => (
                <label key={et.key} className="flex items-center gap-1.5 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedTypes.has(et.key)}
                    onChange={() => toggleType(et.key)}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  {et.displayName}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={create}
              onChange={(e) => setCreate(e.target.checked)}
              className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
            />
            Create in graph
          </label>

          <button
            type="submit"
            disabled={loading || !text.trim()}
            className="px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Extracting...' : 'Extract'}
          </button>

          {hasContent && (
            <button
              type="button"
              onClick={handleReset}
              disabled={loading}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Reset
            </button>
          )}
        </div>
      </form>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
          Extracting...
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {response && (
        <div className="space-y-4">
          {response.created && (
            <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
              Entities and relations created in graph.
            </div>
          )}

          {response.entities.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">
                Entities ({response.entities.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {response.entities.map((entity, i) => (
                  <div key={i} className="p-3 bg-white border border-gray-200 rounded-lg">
                    <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded mb-2">
                      {entity.entityTypeKey}
                    </span>
                    <div className="space-y-1">
                      {Object.entries(entity.properties).map(([k, v]) => (
                        <div key={k} className="text-xs">
                          <span className="text-gray-500">{k}:</span>{' '}
                          <span className="text-gray-900">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {response.relations.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">
                Relations ({response.relations.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {response.relations.map((rel, i) => (
                  <div key={i} className="p-3 bg-white border border-gray-200 rounded-lg">
                    <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded mb-2">
                      {rel.relationTypeKey}
                    </span>
                    <div className="text-xs text-gray-700">
                      {JSON.stringify(rel.source.match)} → {JSON.stringify(rel.target.match)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {response.entities.length === 0 && response.relations.length === 0 && (
            <p className="text-sm text-gray-500 italic">No entities or relations extracted.</p>
          )}
        </div>
      )}
    </div>
  );
}
