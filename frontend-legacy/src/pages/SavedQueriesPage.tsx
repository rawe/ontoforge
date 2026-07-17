import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SavedQueryStep } from '../types/models';
import * as api from '../api/client';
import * as runtimeApi from '../api/runtimeClient';
import SavedQueryForm from '../components/forms/SavedQueryForm';

export default function SavedQueriesPage() {
  const { ontologyId } = useParams<{ ontologyId: string }>();

  const { data: ontology = null, isLoading: ontologyLoading } = useQuery({
    queryKey: ['ontology', ontologyId],
    queryFn: () => api.getOntology(ontologyId!),
    enabled: !!ontologyId,
  });

  const { data: savedQueries = [], refetch: refetchQueries } = useQuery({
    queryKey: ['ontology', ontology?.key, 'saved-queries'],
    queryFn: () => api.listSavedQueries(ontology!.key),
    enabled: !!ontology?.key,
  });

  const [addingQuery, setAddingQuery] = useState(false);
  const [editingQueryKey, setEditingQueryKey] = useState<string | null>(null);
  const [testingQueryKey, setTestingQueryKey] = useState<string | null>(null);

  const handleCreateQuery = async (data: { key: string; name: string; description: string; steps: SavedQueryStep[]; parameters: { name: string; description: string; dataType: string }[] }) => {
    if (!ontology) return;
    try {
      await api.upsertSavedQuery(ontology.key, data.key, data);
      refetchQueries();
      setAddingQuery(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create saved query');
    }
  };

  const handleUpdateQuery = async (data: { key: string; name: string; description: string; steps: SavedQueryStep[]; parameters: { name: string; description: string; dataType: string }[] }) => {
    if (!ontology) return;
    try {
      await api.upsertSavedQuery(ontology.key, data.key, data);
      refetchQueries();
      setEditingQueryKey(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update saved query');
    }
  };

  const handleDeleteQuery = async (queryKey: string) => {
    if (!ontology || !confirm(`Delete saved query "${queryKey}"?`)) return;
    try {
      await api.deleteSavedQuery(ontology.key, queryKey);
      refetchQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete saved query');
    }
  };

  if (ontologyLoading) return <p>Loading...</p>;
  if (!ontology) return <p>Ontology not found.</p>;

  return (
    <div>
      <Link to={`/ontologies/${ontologyId}`} className="text-blue-600 hover:underline text-sm">&larr; Back to scope</Link>

      <div className="mt-4 mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Saved Queries</h2>
        <p className="text-sm text-gray-500 mt-1">
          Ontology: <span className="font-mono">{ontology.key}</span>
        </p>
      </div>

      {savedQueries.length === 0 && !addingQuery && (
        <p className="text-gray-400 text-sm italic mb-3">No saved queries configured.</p>
      )}

      <div className="space-y-2 mb-3">
        {savedQueries.map((sq) =>
          editingQueryKey === sq.key ? (
            <SavedQueryForm
              key={sq.key}
              initial={sq}
              onSubmit={handleUpdateQuery}
              onCancel={() => setEditingQueryKey(null)}
            />
          ) : (
            <div key={sq.key} className="bg-white border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-gray-900 truncate">{sq.name}</span>
                  <span className="text-sm text-gray-400 font-mono shrink-0">{sq.key}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">
                    {sq.steps.length} step{sq.steps.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">
                    {sq.parameters.length === 0 ? 'no params' : `${sq.parameters.length} param${sq.parameters.length === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div className="flex gap-2 shrink-0 ml-2">
                  <button
                    onClick={() => setTestingQueryKey(testingQueryKey === sq.key ? null : sq.key)}
                    className={`text-sm ${testingQueryKey === sq.key ? 'text-green-700 font-medium' : 'text-green-600 hover:text-green-800'}`}
                  >
                    Test
                  </button>
                  <button onClick={() => setEditingQueryKey(sq.key)} className="text-sm text-blue-600 hover:text-blue-800">Edit</button>
                  <button onClick={() => handleDeleteQuery(sq.key)} className="text-sm text-red-600 hover:text-red-800">Delete</button>
                </div>
              </div>
              {testingQueryKey === sq.key && (
                <SavedQueryTestPanel ontologyKey={ontology.key} queryKey={sq.key} parameters={sq.parameters} />
              )}
            </div>
          ),
        )}
      </div>

      {addingQuery ? (
        <SavedQueryForm onSubmit={handleCreateQuery} onCancel={() => setAddingQuery(false)} />
      ) : (
        <button
          onClick={() => setAddingQuery(true)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          Add saved query
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SavedQueryTestPanel — inline test runner for saved queries
// ---------------------------------------------------------------------------

function SavedQueryTestPanel({ ontologyKey, queryKey, parameters }: {
  ontologyKey: string;
  queryKey: string;
  parameters: { name: string; description: string; dataType: string }[];
}) {
  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of parameters) init[p.name] = '';
    return init;
  });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ columns: string[]; results: Record<string, unknown>[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const params: Record<string, unknown> = {};
      for (const p of parameters) {
        const val = paramValues[p.name];
        if (!val && val !== '0') {
          setError(`Parameter "${p.name}" is required`);
          setRunning(false);
          return;
        }
        params[p.name] = val;
      }
      const res = await runtimeApi.runSavedQuery(ontologyKey, queryKey, params);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
      {parameters.length > 0 && (
        <div className="space-y-2 mb-3">
          {parameters.map((p) => (
            <div key={p.name} className="flex items-center gap-2">
              <label className="text-sm text-gray-600 w-28 shrink-0 font-mono">{p.name}</label>
              <input
                type="text"
                placeholder={p.description}
                value={paramValues[p.name] ?? ''}
                onChange={(e) => setParamValues({ ...paramValues, [p.name]: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm flex-1"
                onKeyDown={(e) => { if (e.key === 'Enter') handleRun(); }}
              />
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">{p.dataType}</span>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={handleRun}
        disabled={running}
        className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
      >
        {running ? 'Running...' : 'Run query'}
      </button>
      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}
      {result && (
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-500">
              {result.results.length} result{result.results.length === 1 ? '' : 's'}
            </span>
            <span className="text-xs text-gray-400">
              columns: {result.columns.join(', ')}
            </span>
          </div>
          <pre className="p-3 bg-gray-900 text-green-400 text-xs rounded overflow-auto max-h-64 font-mono">
            {JSON.stringify(result.results, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
