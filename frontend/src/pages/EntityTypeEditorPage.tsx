import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { EntityType, PropertyDefinition } from '../types/models';
import * as api from '../api/client';
import PropertyTable from '../components/PropertyTable';
import EntityTypeForm from '../components/forms/EntityTypeForm';

export default function EntityTypeEditorPage() {
  const { ontologyId, entityTypeId } = useParams<{ ontologyId: string; entityTypeId: string }>();
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [properties, setProperties] = useState<PropertyDefinition[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!ontologyId || !entityTypeId) return;
    try {
      const [et, props] = await Promise.all([
        api.getEntityType(ontologyId, entityTypeId),
        api.listProperties(ontologyId, 'entity-types', entityTypeId),
      ]);
      setEntityType(et);
      setProperties(props);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [ontologyId, entityTypeId]);

  const handleUpdate = async (data: { displayName?: string; description?: string }) => {
    if (!ontologyId || !entityTypeId) return;
    try {
      setEntityType(await api.updateEntityType(ontologyId, entityTypeId, data));
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
    }
  };

  const handleAddProperty = async (data: { key: string; displayName: string; description?: string; dataType: string; required?: boolean; defaultValue?: string }) => {
    if (!ontologyId || !entityTypeId) return;
    try {
      await api.createProperty(ontologyId, 'entity-types', entityTypeId, data);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add property');
    }
  };

  const handleEditProperty = async (propertyId: string, data: { displayName?: string; description?: string; required?: boolean; defaultValue?: string | null }) => {
    if (!ontologyId || !entityTypeId) return;
    try {
      await api.updateProperty(ontologyId, 'entity-types', entityTypeId, propertyId, data);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update property');
    }
  };

  const handleDeleteProperty = async (propertyId: string) => {
    if (!ontologyId || !entityTypeId) return;
    try {
      await api.deleteProperty(ontologyId, 'entity-types', entityTypeId, propertyId);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete property');
    }
  };

  if (loading) return <p>Loading...</p>;
  if (!entityType) return <p>Entity type not found.</p>;

  return (
    <div>
      <Link to={`/ontologies/${ontologyId}`} className="text-blue-600 hover:underline text-sm">&larr; Back to ontology</Link>

      <div className="mt-4 mb-6">
        {editing ? (
          <EntityTypeForm
            initial={{ key: entityType.key, displayName: entityType.displayName, description: entityType.description ?? '' }}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-gray-900">{entityType.displayName}</h2>
              <span className="text-sm text-gray-400 font-mono">{entityType.key}</span>
              <button onClick={() => setEditing(true)} className="text-sm text-blue-600 hover:underline">Edit</button>
            </div>
            <p className="text-gray-500 mt-1">{entityType.description || 'No description'}</p>
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
