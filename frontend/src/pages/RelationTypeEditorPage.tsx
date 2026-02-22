import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { RelationType, EntityType, PropertyDefinition } from '../types/models';
import * as api from '../api/client';
import PropertyTable from '../components/PropertyTable';
import RelationTypeForm from '../components/forms/RelationTypeForm';

export default function RelationTypeEditorPage() {
  const { ontologyId, relationTypeId } = useParams<{ ontologyId: string; relationTypeId: string }>();
  const [relationType, setRelationType] = useState<RelationType | null>(null);
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [properties, setProperties] = useState<PropertyDefinition[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!ontologyId || !relationTypeId) return;
    try {
      const [rt, ets, props] = await Promise.all([
        api.getRelationType(ontologyId, relationTypeId),
        api.listEntityTypes(ontologyId),
        api.listProperties(ontologyId, 'relation-types', relationTypeId),
      ]);
      setRelationType(rt);
      setEntityTypes(ets);
      setProperties(props);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [ontologyId, relationTypeId]);

  const handleUpdate = async (data: { displayName?: string; description?: string }) => {
    if (!ontologyId || !relationTypeId) return;
    try {
      setRelationType(await api.updateRelationType(ontologyId, relationTypeId, data));
      setEditing(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update');
    }
  };

  const handleAddProperty = async (data: { key: string; displayName: string; description?: string; dataType: string; required?: boolean; defaultValue?: string }) => {
    if (!ontologyId || !relationTypeId) return;
    try {
      await api.createProperty(ontologyId, 'relation-types', relationTypeId, data);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add property');
    }
  };

  const handleEditProperty = async (propertyId: string, data: { displayName?: string; description?: string; required?: boolean; defaultValue?: string | null }) => {
    if (!ontologyId || !relationTypeId) return;
    try {
      await api.updateProperty(ontologyId, 'relation-types', relationTypeId, propertyId, data);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update property');
    }
  };

  const handleDeleteProperty = async (propertyId: string) => {
    if (!ontologyId || !relationTypeId) return;
    try {
      await api.deleteProperty(ontologyId, 'relation-types', relationTypeId, propertyId);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete property');
    }
  };

  const sourceName = entityTypes.find((et) => et.entityTypeId === relationType?.sourceEntityTypeId);
  const targetName = entityTypes.find((et) => et.entityTypeId === relationType?.targetEntityTypeId);

  if (loading) return <p>Loading...</p>;
  if (!relationType) return <p>Relation type not found.</p>;

  return (
    <div>
      <Link to={`/ontologies/${ontologyId}`} className="text-blue-600 hover:underline text-sm">&larr; Back to ontology</Link>

      <div className="mt-4 mb-6">
        {editing ? (
          <RelationTypeForm
            entityTypes={entityTypes}
            initial={{
              key: relationType.key,
              displayName: relationType.displayName,
              description: relationType.description ?? '',
              sourceEntityTypeId: relationType.sourceEntityTypeId,
              targetEntityTypeId: relationType.targetEntityTypeId,
            }}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-gray-900">{relationType.displayName}</h2>
              <span className="text-sm text-gray-400 font-mono">{relationType.key}</span>
              <button onClick={() => setEditing(true)} className="text-sm text-blue-600 hover:underline">Edit</button>
            </div>
            <p className="text-gray-500 mt-1">{relationType.description || 'No description'}</p>
            <div className="mt-2 text-sm text-gray-600">
              <span className="font-medium">{sourceName?.displayName ?? relationType.sourceEntityTypeId}</span>
              <span className="mx-2 text-gray-400">&rarr;</span>
              <span className="font-medium">{targetName?.displayName ?? relationType.targetEntityTypeId}</span>
            </div>
          </div>
        )}
      </div>

      <PropertyTable
        properties={properties}
        onAdd={handleAddProperty}
        onEdit={handleEditProperty}
        onDelete={handleDeleteProperty}
      />
    </div>
  );
}
