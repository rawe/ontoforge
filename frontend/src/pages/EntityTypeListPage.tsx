import { useParams, Link } from 'react-router-dom';
import { useRuntimeSchema } from '../hooks/useRuntimeSchema';

export default function EntityTypeListPage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>();
  const { data: schema, isLoading, error } = useRuntimeSchema(ontologyKey);

  if (isLoading) return <p>Loading schema...</p>;
  if (error) return <p className="text-red-600">Error: {error.message}</p>;
  if (!schema) return <p>Schema not found.</p>;

  return (
    <div>
      <Link to={`/data/${ontologyKey}`} className="text-blue-600 hover:underline text-sm">&larr; Back to data</Link>

      <div className="mt-4 mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Entity Types</h2>
        <p className="text-sm text-gray-500 mt-1">
          Ontology: <span className="font-mono">{schema.ontology.key}</span>
        </p>
      </div>

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
    </div>
  );
}
