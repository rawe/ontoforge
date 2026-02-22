import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useRuntimeSchema } from '../context/RuntimeSchemaContext';
import * as runtimeApi from '../api/runtimeClient';

export default function RuntimeDashboardPage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>();
  const { schema, loading, error } = useRuntimeSchema();
  const [wiping, setWiping] = useState(false);

  const handleWipe = async () => {
    if (!ontologyKey) return;
    if (!confirm('Delete ALL instance data for this ontology? Schema will be preserved.')) return;
    setWiping(true);
    try {
      const result = await runtimeApi.wipeData(ontologyKey);
      alert(`Wiped ${result.entitiesDeleted} entities and ${result.relationsDeleted} relations.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Wipe failed');
    } finally {
      setWiping(false);
    }
  };

  if (loading) return <p>Loading schema...</p>;
  if (error) return <p className="text-red-600">Error: {error}</p>;
  if (!schema) return <p>Schema not found.</p>;

  return (
    <div>
      <Link to={`/ontologies/${schema.ontology.ontologyId}`} className="text-blue-600 hover:underline text-sm">
        &larr; Back to ontology
      </Link>

      <div className="mt-4 mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-900">{schema.ontology.name}</h2>
          <span className="text-sm text-gray-400 font-mono">{schema.ontology.key}</span>
        </div>
        <p className="text-gray-500 mt-1">{schema.ontology.description || 'No description'}</p>
      </div>

      <div className="flex gap-3 mb-6">
        <Link
          to={`/ontologies/${schema.ontology.ontologyId}`}
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 border border-gray-300"
        >
          Schema
        </Link>
        <button
          onClick={handleWipe}
          disabled={wiping}
          className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
        >
          {wiping ? 'Wiping...' : 'Wipe Data'}
        </button>
      </div>

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
