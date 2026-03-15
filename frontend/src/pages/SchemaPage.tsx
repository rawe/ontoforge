import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ValidationResult } from '../types/models';
import * as api from '../api/client';
import { ApiError } from '../api/client';
import TypeList from '../components/TypeList';
import EntityTypeForm from '../components/forms/EntityTypeForm';
import RelationTypeForm from '../components/forms/RelationTypeForm';
import OntologyGraph from '../components/graph/OntologyGraph';
import Modal from '../components/Modal';
import AutoRefreshToggle from '../components/AutoRefreshToggle';

export default function SchemaPage() {
  const queryClient = useQueryClient();
  const [showEntityForm, setShowEntityForm] = useState(false);
  const [showRelationForm, setShowRelationForm] = useState(false);
  const [relationDefaults, setRelationDefaults] = useState<{ sourceKey: string; targetKey: string } | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const viewMode = searchParams.get('view') === 'list' ? 'list' : 'graph';
  const setViewMode = (mode: 'list' | 'graph') => {
    setSearchParams(mode === 'list' ? { view: 'list' } : {}, { replace: true });
  };
  const [propertyCounts, setPropertyCounts] = useState<Record<string, number>>({});
  const [autoRefresh, setAutoRefresh] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: entityTypes = [], isLoading: entityTypesLoading } = useQuery({
    queryKey: ['entityTypes'],
    queryFn: () => api.listEntityTypes(),
    refetchInterval: autoRefresh ? 3000 : false,
  });

  const { data: relationTypes = [] } = useQuery({
    queryKey: ['relationTypes'],
    queryFn: () => api.listRelationTypes(),
    refetchInterval: autoRefresh ? 3000 : false,
  });

  // Fetch property counts when entity types change
  useEffect(() => {
    if (entityTypes.length === 0) return;
    const fetchCounts = async () => {
      const counts: Record<string, number> = {};
      await Promise.all(
        entityTypes.map(async (et) => {
          try {
            const props = await api.listProperties('entity-types', et.entityTypeId);
            counts[et.entityTypeId] = props.length;
          } catch {
            counts[et.entityTypeId] = 0;
          }
        }),
      );
      setPropertyCounts(counts);
    };
    fetchCounts();
  }, [entityTypes]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['entityTypes'] });
    queryClient.invalidateQueries({ queryKey: ['relationTypes'] });
  };

  const handleCreateEntityType = async (data: { key: string; displayName: string; description?: string }) => {
    try {
      await api.createEntityType(data);
      setShowEntityForm(false);
      invalidateAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create entity type');
    }
  };

  const handleDeleteEntityType = async (id: string) => {
    try {
      await api.deleteEntityType(id);
      invalidateAll();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CASCADE_REQUIRED') {
        const affected = e.details?.affectedOntologies as string[] | undefined;
        if (affected && confirm(`This type is used by ontologies: ${affected.join(', ')}. Delete anyway?`)) {
          try {
            await api.deleteEntityType(id, true);
            invalidateAll();
          } catch (e2) {
            toast.error(e2 instanceof Error ? e2.message : 'Failed to delete');
          }
        }
      } else {
        toast.error(e instanceof Error ? e.message : 'Failed to delete entity type');
      }
    }
  };

  const handleCreateRelationType = async (data: { key: string; displayName: string; description?: string; sourceEntityTypeKey: string; targetEntityTypeKey: string }) => {
    try {
      await api.createRelationType(data);
      setShowRelationForm(false);
      invalidateAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create relation type');
    }
  };

  const handleDeleteRelationType = async (id: string) => {
    try {
      await api.deleteRelationType(id);
      invalidateAll();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CASCADE_REQUIRED') {
        const affected = e.details?.affectedOntologies as string[] | undefined;
        if (affected && confirm(`This type is used by ontologies: ${affected.join(', ')}. Delete anyway?`)) {
          try {
            await api.deleteRelationType(id, true);
            invalidateAll();
          } catch (e2) {
            toast.error(e2 instanceof Error ? e2.message : 'Failed to delete');
          }
        }
      } else {
        toast.error(e instanceof Error ? e.message : 'Failed to delete relation type');
      }
    }
  };

  const handleValidate = async () => {
    try {
      setValidation(await api.validateSchema());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Validation failed');
    }
  };

  const handleExport = async () => {
    try {
      const data = await api.exportSchema();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'schema.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    }
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await api.importSchema(data);
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ['ontologies'] });
      toast.success('Schema imported successfully');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RESOURCE_CONFLICT') {
        toast.error(`Import conflict: ${e.message}`);
      } else {
        toast.error(e instanceof Error ? e.message : 'Failed to import schema');
      }
    }
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImport(file);
    e.target.value = '';
  };

  if (entityTypesLoading) return <p>Loading...</p>;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Schema</h2>
        <p className="text-gray-500 mt-1">Global entity types, relation types, and properties</p>
      </div>

      <div className="flex gap-3 mb-6 items-center">
        <button onClick={handleValidate} className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700">
          Validate
        </button>
        <button onClick={handleExport} className="px-4 py-2 bg-gray-600 text-white text-sm rounded hover:bg-gray-700">
          Export
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 border border-gray-300"
        >
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={onFileSelected}
          className="hidden"
        />
        <AutoRefreshToggle enabled={autoRefresh} onToggle={setAutoRefresh} />
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
          onClick={() => setViewMode('graph')}
          className={`px-3 py-1.5 text-sm font-medium rounded-l-md border ${
            viewMode === 'graph'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          Graph
        </button>
        <button
          onClick={() => setViewMode('list')}
          className={`px-3 py-1.5 text-sm font-medium rounded-r-md border border-l-0 ${
            viewMode === 'list'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          List
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
              basePath="/schema/entity-types"
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
              basePath="/schema/relation-types"
              onDelete={handleDeleteRelationType}
            />
          </section>
        </>
      ) : (
        <>
          <OntologyGraph
            entityTypes={entityTypes}
            relationTypes={relationTypes}
            propertyCounts={propertyCounts}
            onAddEntityType={() => { setShowRelationForm(false); setRelationDefaults(null); setShowEntityForm(true); }}
            onAddRelationType={() => { setShowEntityForm(false); setRelationDefaults(null); setShowRelationForm(true); }}
            onConnectNodes={(sourceKey, targetKey) => { setShowEntityForm(false); setRelationDefaults({ sourceKey, targetKey }); setShowRelationForm(true); }}
          />
          <Modal open={showEntityForm} onClose={() => setShowEntityForm(false)} title="Add Entity Type">
            <EntityTypeForm onSubmit={handleCreateEntityType} onCancel={() => setShowEntityForm(false)} />
          </Modal>
          <Modal open={showRelationForm} onClose={() => { setShowRelationForm(false); setRelationDefaults(null); }} title="Add Relation Type">
            <RelationTypeForm
              key={relationDefaults ? `${relationDefaults.sourceKey}-${relationDefaults.targetKey}` : 'empty'}
              entityTypes={entityTypes}
              defaultSourceKey={relationDefaults?.sourceKey}
              defaultTargetKey={relationDefaults?.targetKey}
              onSubmit={handleCreateRelationType}
              onCancel={() => { setShowRelationForm(false); setRelationDefaults(null); }}
            />
          </Modal>
        </>
      )}
    </div>
  );
}
