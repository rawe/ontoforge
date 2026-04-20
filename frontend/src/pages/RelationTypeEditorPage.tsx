import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { RelationType, EntityType, PropertyDefinition } from '../types/models';
import * as api from '../api/client';
import PropertyTable from '../components/PropertyTable';
import RelationTypeForm from '../components/forms/RelationTypeForm';

export default function RelationTypeEditorPage() {
  const { relationTypeId } = useParams<{ relationTypeId: string }>();
  const [relationType, setRelationType] = useState<RelationType | null>(null);
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [properties, setProperties] = useState<PropertyDefinition[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!relationTypeId) return;
    try {
      const [rt, ets, props] = await Promise.all([
        api.getRelationType(relationTypeId),
        api.listEntityTypes(),
        api.listProperties('relation-types', relationTypeId),
      ]);
      setRelationType(rt);
      setEntityTypes(ets);
      setProperties(props);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [relationTypeId]);

  const handleUpdate = async (data: { displayName?: string; description?: string; factTemplate?: string | null }) => {
    if (!relationTypeId) return;
    try {
      setRelationType(await api.updateRelationType(relationTypeId, data));
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
    }
  };

  const handleAddProperty = async (data: { key: string; displayName: string; description?: string; dataType: string; required?: boolean; defaultValue?: string }) => {
    if (!relationTypeId) return;
    try {
      await api.createProperty('relation-types', relationTypeId, data);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add property');
    }
  };

  const handleEditProperty = async (propertyId: string, data: { displayName?: string; description?: string; required?: boolean; defaultValue?: string | null }) => {
    if (!relationTypeId) return;
    try {
      await api.updateProperty('relation-types', relationTypeId, propertyId, data);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update property');
    }
  };

  const handleDeleteProperty = async (propertyId: string) => {
    if (!relationTypeId) return;
    try {
      await api.deleteProperty('relation-types', relationTypeId, propertyId);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete property');
    }
  };

  const sourceName = entityTypes.find((et) => et.key === relationType?.sourceEntityTypeKey);
  const targetName = entityTypes.find((et) => et.key === relationType?.targetEntityTypeKey);

  if (loading) return <p>Loading...</p>;
  if (!relationType) return <p>Relation type not found.</p>;

  return (
    <div>
      <Link to="/schema" className="text-blue-600 hover:underline text-sm">&larr; Back to schema</Link>

      <div className="mt-4 mb-6">
        {editing ? (
          <RelationTypeForm
            entityTypes={entityTypes}
            initial={{
              key: relationType.key,
              displayName: relationType.displayName,
              description: relationType.description ?? '',
              sourceEntityTypeKey: relationType.sourceEntityTypeKey,
              targetEntityTypeKey: relationType.targetEntityTypeKey,
              factTemplate: relationType.factTemplate,
            }}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-gray-900">{relationType.displayName}</h2>
              <span className="text-sm text-gray-400 font-mono">{relationType.key}</span>
              {relationType.factTemplate && (
                <span className="inline-flex items-center rounded bg-purple-100 text-purple-700 px-2 py-0.5 text-xs font-medium">
                  Semantic
                </span>
              )}
              <button onClick={() => setEditing(true)} className="text-sm text-blue-600 hover:underline">Edit</button>
            </div>
            <p className="text-gray-500 mt-1">{relationType.description || 'No description'}</p>
            <div className="mt-2 text-sm text-gray-600">
              <span className="font-medium">{sourceName?.displayName ?? relationType.sourceEntityTypeKey}</span>
              <span className="mx-2 text-gray-400">&rarr;</span>
              <span className="font-medium">{targetName?.displayName ?? relationType.targetEntityTypeKey}</span>
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
