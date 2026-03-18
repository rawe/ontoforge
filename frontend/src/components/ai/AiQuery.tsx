import { useState } from 'react';
import { toast } from 'sonner';
import { aiQuery } from '../../api/runtimeClient';
import { useAiState } from '../../hooks/useAiState';
import Markdown from './Markdown';

interface AiQueryProps {
  ontologyKey: string;
}

export default function AiQuery({ ontologyKey }: AiQueryProps) {
  const { getState, updateQuery, resetQuery } = useAiState();
  const { question, response, error } = getState(ontologyKey).query;
  const [loading, setLoading] = useState(false);

  const setQuestion = (q: string) => updateQuery(ontologyKey, { question: q });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || loading) return;

    setLoading(true);
    updateQuery(ontologyKey, { error: null, response: null });

    try {
      const res = await aiQuery(ontologyKey, question.trim());
      updateQuery(ontologyKey, { response: res });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Query failed';
      updateQuery(ontologyKey, { error: msg });
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (loading) return;
    resetQuery(ontologyKey);
  };

  const hasContent = question || response || error;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about your data..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Querying...' : 'Query'}
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
      </form>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
          Thinking...
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {response && (
        <div className="space-y-3">
          <div className="p-4 bg-white border border-gray-200 rounded-lg">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">Answer</h4>
            <Markdown>{response.answer}</Markdown>
          </div>

          {response.cypher && (
            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="text-sm font-semibold text-gray-700 mb-1">Cypher Query</h4>
              <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto">{response.cypher}</pre>
            </div>
          )}

          {response.results && (
            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h4 className="text-sm font-semibold text-gray-700 mb-1">Results</h4>
              <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto">
                {JSON.stringify(response.results, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
