import { useParams, Link } from 'react-router-dom';
import { useRuntimeSchema } from '../hooks/useRuntimeSchema';
import { useFeatures } from '../hooks/useFeatures';
import GlobalSemanticSearch from '../components/runtime/GlobalSemanticSearch';

export default function RuntimeDashboardPage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>();
  const { data: schema, isLoading: loading, error } = useRuntimeSchema(ontologyKey);
  const { data: features } = useFeatures();

  if (loading) return <p>Loading schema...</p>;
  if (error) return <p className="text-red-600">Error: {error.message}</p>;
  if (!schema) return <p>Schema not found.</p>;

  return (
    <div>
      <div className="mt-4 mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-900">{schema.ontology.name}</h2>
          <span className="text-sm text-gray-400 font-mono">{schema.ontology.key}</span>
        </div>
        <p className="text-gray-500 mt-1">{schema.ontology.description || 'No description'}</p>
      </div>

      <div className="flex gap-3 mb-6">
        <Link
          to="/schema"
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 border border-gray-300"
        >
          Schema
        </Link>
        <Link
          to={`/data/${ontologyKey}/graph`}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          Visual Editor
        </Link>
        {features?.ai && (
          <>
            <Link
              to={`/data/${ontologyKey}/ai/query`}
              className="px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700"
            >
              AI Query
            </Link>
            <Link
              to={`/data/${ontologyKey}/ai/extract`}
              className="px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700"
            >
              AI Extract
            </Link>
            <Link
              to={`/data/${ontologyKey}/ai/chat`}
              className="px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700"
            >
              AI Chat
            </Link>
          </>
        )}
      </div>

      {features?.semanticSearch && ontologyKey && (
        <GlobalSemanticSearch ontologyKey={ontologyKey} entityTypes={schema.entityTypes} />
      )}

      {/* Entity Types */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">Entity Types</h3>
        {schema.entityTypes.length === 0 ? (
          <p className="text-gray-400 text-sm italic">No entity types defined.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {schema.entityTypes.map((et) => (
              <Link
                key={et.key}
                to={`/data/${ontologyKey}/entities/${et.key}`}
                className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow block"
              >
                <h4 className="text-md font-semibold text-gray-900">{et.displayName}</h4>
                <p className="text-sm text-gray-400 font-mono">{et.key}</p>
                <p className="text-xs text-gray-500 mt-1">{et.properties.length} properties</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Relation Types */}
      <section>
        <h3 className="text-lg font-semibold text-gray-800 mb-3">Relation Types</h3>
        {schema.relationTypes.length === 0 ? (
          <p className="text-gray-400 text-sm italic">No relation types defined.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {schema.relationTypes.map((rt) => (
              <Link
                key={rt.key}
                to={`/data/${ontologyKey}/relations/${rt.key}`}
                className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow block"
              >
                <h4 className="text-md font-semibold text-gray-900">{rt.displayName}</h4>
                <p className="text-sm text-gray-400 font-mono">{rt.key}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {rt.fromEntityTypeKey} &rarr; {rt.toEntityTypeKey}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
