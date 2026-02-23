import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import type { Ontology, EntityType, RelationType, ValidationResult } from '../types/models';
import * as api from '../api/client';
import TypeList from '../components/TypeList';
import OntologyForm from '../components/forms/OntologyForm';
import EntityTypeForm from '../components/forms/EntityTypeForm';
import RelationTypeForm from '../components/forms/RelationTypeForm';
import OntologyGraph from '../components/graph/OntologyGraph';

export default function OntologyDetailPage() {
  const { ontologyId } = useParams<{ ontologyId: string }>();
  const [ontology, setOntology] = useState<Ontology | null>(null);
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [editing, setEditing] = useState(false);
  const [showEntityForm, setShowEntityForm] = useState(false);
  const [showRelationForm, setShowRelationForm] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const viewMode = searchParams.get('view') === 'graph' ? 'graph' : 'list';
  const setViewMode = (mode: 'list' | 'graph') => {
    setSearchParams(mode === 'graph' ? { view: 'graph' } : {}, { replace: true });
  };
  const [propertyCounts, setPropertyCounts] = useState<Record<string, number>>({});

  const load = async () => {
    if (!ontologyId) return;
    try {
      const [o, ets, rts] = await Promise.all([
        api.getOntology(ontologyId),
        api.listEntityTypes(ontologyId),
        api.listRelationTypes(ontologyId),
      ]);
      setOntology(o);
      setEntityTypes(ets);
      setRelationTypes(rts);

      // Fetch property counts for all entity types
      const counts: Record<string, number> = {};
      await Promise.all(
        ets.map(async (et) => {
          try {
            const props = await api.listProperties(ontologyId, 'entity-types', et.entityTypeId);
            counts[et.entityTypeId] = props.length;
          } catch {
            counts[et.entityTypeId] = 0;
          }
        }),
      );
      setPropertyCounts(counts);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [ontologyId]);

  const handleUpdate = async (data: { name?: string; description?: string }) => {
    if (!ontologyId) return;
    try {
      setOntology(await api.updateOntology(ontologyId, data));
      setEditing(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update');
    }
  };

  const handleCreateEntityType = async (data: { key: string; displayName: string; description?: string }) => {
    if (!ontologyId) return;
    try {
      await api.createEntityType(ontologyId, data);
      setShowEntityForm(false);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create entity type');
    }
  };

  const handleDeleteEntityType = async (id: string) => {
    if (!ontologyId) return;
    try {
      await api.deleteEntityType(ontologyId, id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete entity type');
    }
  };

  const handleCreateRelationType = async (data: { key: string; displayName: string; description?: string; sourceEntityTypeId: string; targetEntityTypeId: string }) => {
    if (!ontologyId) return;
    try {
      await api.createRelationType(ontologyId, data);
      setShowRelationForm(false);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create relation type');
    }
  };

  const handleDeleteRelationType = async (id: string) => {
    if (!ontologyId) return;
    try {
      await api.deleteRelationType(ontologyId, id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete relation type');
    }
  };

  const handleValidate = async () => {
    if (!ontologyId) return;
    try {
      setValidation(await api.validateSchema(ontologyId));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Validation failed');
    }
  };

  const handleExport = async () => {
    if (!ontologyId) return;
    try {
      const data = await api.exportSchema(ontologyId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ontology?.name ?? 'ontology'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Export failed');
    }
  };

  if (loading) return <p>Loading...</p>;
  if (!ontology) return <p>Ontology not found.</p>;

  return (
    <div>
      <Link to="/ontologies" className="text-blue-600 hover:underline text-sm">&larr; Back to ontologies</Link>

      <div className="mt-4 mb-6">
        {editing ? (
          <OntologyForm
            initial={{ name: ontology.name, description: ontology.description ?? '' }}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-gray-900">{ontology.name}</h2>
              <span className="text-sm text-gray-400 font-mono">{ontology.key}</span>
              <button onClick={() => setEditing(true)} className="text-sm text-blue-600 hover:underline">Edit</button>
            </div>
            <p className="text-gray-500 mt-1">{ontology.description || 'No description'}</p>
            <p className="text-xs text-gray-400 mt-1">
              Created {new Date(ontology.createdAt).toLocaleString()} | Updated {new Date(ontology.updatedAt).toLocaleString()}
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-3 mb-6">
        <button onClick={handleValidate} className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700">
          Validate Schema
        </button>
        <button onClick={handleExport} className="px-4 py-2 bg-gray-600 text-white text-sm rounded hover:bg-gray-700">
          Export
        </button>
        <Link
          to={`/data/${ontology.key}`}
          className="px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700"
        >
          Manage Data
        </Link>
      </div>

      {validation && (
        <div className={`mb-6 p-4 rounded border ${validation.valid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <p className={`font-semibold ${validation.valid ? 'text-green-700' : 'text-red-700'}`}>
            {validation.valid ? 'Schema is valid' : 'Schema has errors'}
          </p>
          {validation.errors.length > 0 && (
            <ul className="mt-2 text-sm text-red-600 list-disc list-inside">
              {validation.errors.map((err, i) => (
                <li key={i}><span className="font-mono">{err.path}</span>: {err.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* View mode toggle */}
      <div className="flex items-center gap-1 mb-4">
        <button
          onClick={() => setViewMode('list')}
          className={`px-3 py-1.5 text-sm font-medium rounded-l-md border ${
            viewMode === 'list'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          List
        </button>
        <button
          onClick={() => setViewMode('graph')}
          className={`px-3 py-1.5 text-sm font-medium rounded-r-md border border-l-0 ${
            viewMode === 'graph'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          Graph
        </button>
      </div>

      {viewMode === 'list' ? (
        <>
          {/* Entity Types */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-800">Entity Types</h3>
              <button
                onClick={() => setShowEntityForm(!showEntityForm)}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
              >
                {showEntityForm ? 'Cancel' : 'Add Entity Type'}
              </button>
            </div>
            {showEntityForm && (
              <div className="mb-4 p-4 bg-white border rounded-lg">
                <EntityTypeForm onSubmit={handleCreateEntityType} onCancel={() => setShowEntityForm(false)} />
              </div>
            )}
            <TypeList
              items={entityTypes.map((et) => ({ id: et.entityTypeId, key: et.key, displayName: et.displayName, description: et.description }))}
              basePath={`/ontologies/${ontologyId}/entity-types`}
              onDelete={handleDeleteEntityType}
            />
          </section>

          {/* Relation Types */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-800">Relation Types</h3>
              <button
                onClick={() => setShowRelationForm(!showRelationForm)}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
              >
                {showRelationForm ? 'Cancel' : 'Add Relation Type'}
              </button>
            </div>
            {showRelationForm && (
              <div className="mb-4 p-4 bg-white border rounded-lg">
                <RelationTypeForm
                  entityTypes={entityTypes}
                  onSubmit={handleCreateRelationType}
                  onCancel={() => setShowRelationForm(false)}
                />
              </div>
            )}
            <TypeList
              items={relationTypes.map((rt) => ({ id: rt.relationTypeId, key: rt.key, displayName: rt.displayName, description: rt.description }))}
              basePath={`/ontologies/${ontologyId}/relation-types`}
              onDelete={handleDeleteRelationType}
            />
          </section>
        </>
      ) : (
        <OntologyGraph
          entityTypes={entityTypes}
          relationTypes={relationTypes}
          propertyCounts={propertyCounts}
        />
      )}
    </div>
  );
}
