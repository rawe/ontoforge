import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ValidationResult, IncludeTypeResponse, PropertyDefinition } from '../types/models';
import * as api from '../api/client';
import { useRuntimeSchema } from '../hooks/useRuntimeSchema';
import OntologyForm from '../components/forms/OntologyForm';
import ScopedOntologyGraph from '../components/graph/ScopedOntologyGraph';

export default function OntologyDetailPage() {
  const { ontologyId } = useParams<{ ontologyId: string }>();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [activeTab, setActiveTab] = useState<'configure' | 'diagram'>('configure');

  const { data: ontology = null, isLoading: ontologyLoading } = useQuery({
    queryKey: ['ontology', ontologyId],
    queryFn: () => api.getOntology(ontologyId!),
    enabled: !!ontologyId,
  });

  const { data: runtimeSchema, isLoading: schemaLoading } = useRuntimeSchema(ontology?.key);

  const { data: allEntityTypes = [] } = useQuery({
    queryKey: ['entityTypes'],
    queryFn: () => api.listEntityTypes(),
  });

  const { data: allRelationTypes = [] } = useQuery({
    queryKey: ['relationTypes'],
    queryFn: () => api.listRelationTypes(),
  });

  const { data: includedEntityTypes = [], refetch: refetchEntityInclusions } = useQuery({
    queryKey: ['ontology', ontologyId, 'includes', 'entity-types'],
    queryFn: () => api.listIncludesEntityTypes(ontologyId!),
    enabled: !!ontologyId,
  });

  const { data: includedRelationTypes = [], refetch: refetchRelationInclusions } = useQuery({
    queryKey: ['ontology', ontologyId, 'includes', 'relation-types'],
    queryFn: () => api.listIncludesRelationTypes(ontologyId!),
    enabled: !!ontologyId,
  });

  const isScoped = includedEntityTypes.length > 0 || includedRelationTypes.length > 0;
  const includedETKeys = new Set(includedEntityTypes.map((i) => i.key));
  const includedRTKeys = new Set(includedRelationTypes.map((i) => i.key));

  const invalidateSchema = () => queryClient.invalidateQueries({ queryKey: ['schema'] });

  const handleUpdate = async (data: { name?: string; description?: string }) => {
    if (!ontologyId) return;
    try {
      await api.updateOntology(ontologyId, data);
      queryClient.invalidateQueries({ queryKey: ['ontology', ontologyId] });
      queryClient.invalidateQueries({ queryKey: ['ontologies'] });
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
    }
  };

  const handleValidate = async () => {
    if (!ontologyId) return;
    try {
      setValidation(await api.validateOntology(ontologyId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Validation failed');
    }
  };

  const handleAddEntityType = async (key: string) => {
    if (!ontologyId) return;
    try {
      await api.addIncludesEntityType(ontologyId, { key, properties: null });
      refetchEntityInclusions();
      invalidateSchema();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add entity type');
    }
  };

  const handleRemoveEntityType = async (typeId: string) => {
    if (!ontologyId) return;
    try {
      await api.removeIncludesEntityType(ontologyId, typeId);
      refetchEntityInclusions();
      invalidateSchema();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove');
    }
  };

  const handleUpdateEntityTypeScope = async (typeId: string, properties: string[] | null) => {
    if (!ontologyId) return;
    try {
      await api.updateIncludesEntityType(ontologyId, typeId, { properties });
      refetchEntityInclusions();
      invalidateSchema();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update scope');
    }
  };

  const handleAddRelationType = async (key: string) => {
    if (!ontologyId) return;
    try {
      await api.addIncludesRelationType(ontologyId, { key, properties: null });
      refetchRelationInclusions();
      invalidateSchema();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add relation type');
    }
  };

  const handleRemoveRelationType = async (typeId: string) => {
    if (!ontologyId) return;
    try {
      await api.removeIncludesRelationType(ontologyId, typeId);
      refetchRelationInclusions();
      invalidateSchema();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove');
    }
  };

  const handleUpdateRelationTypeScope = async (typeId: string, properties: string[] | null) => {
    if (!ontologyId) return;
    try {
      await api.updateIncludesRelationType(ontologyId, typeId, { properties });
      refetchRelationInclusions();
      invalidateSchema();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update scope');
    }
  };

  if (ontologyLoading) return <p>Loading...</p>;
  if (!ontology) return <p>Ontology not found.</p>;

  const availableEntityTypes = allEntityTypes.filter((et) => !includedETKeys.has(et.key));
  const availableRelationTypes = allRelationTypes.filter((rt) => !includedRTKeys.has(rt.key));

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
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isScoped ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                {isScoped ? 'scoped' : 'unscoped'}
              </span>
              <button onClick={() => setEditing(true)} className="text-sm text-blue-600 hover:underline">Edit</button>
            </div>
            <p className="text-gray-500 mt-1">{ontology.description || 'No description'}</p>
          </div>
        )}
      </div>

      <div className="flex gap-3 mb-6">
        <button onClick={handleValidate} className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700">
          Validate
        </button>
        <Link
          to={`/data/${ontology.key}`}
          className="px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700"
        >
          Data
        </Link>
      </div>

      {validation && (
        <div className={`mb-6 p-4 rounded border ${validation.valid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <p className={`font-semibold ${validation.valid ? 'text-green-700' : 'text-red-700'}`}>
            {validation.valid ? 'Ontology scope is valid' : 'Scope has errors'}
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

      {!isScoped && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm text-blue-700">
            This ontology is <strong>unscoped</strong> — it exposes the entire global schema.
            Add entity or relation types below to create a scoped view.
          </p>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        <button
          onClick={() => setActiveTab('configure')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'configure'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Configure
        </button>
        <button
          onClick={() => setActiveTab('diagram')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'diagram'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Diagram
        </button>
      </div>

      {activeTab === 'configure' && (
        <>
          {/* Entity Type Inclusions */}
          <section className="mb-8">
            <h3 className="text-lg font-semibold text-gray-800 mb-3">Included Entity Types</h3>
            {includedEntityTypes.length === 0 ? (
              <p className="text-gray-400 text-sm italic mb-3">No entity types included (all are visible).</p>
            ) : (
              <div className="space-y-2 mb-3">
                {includedEntityTypes.map((inc) => {
                  const et = allEntityTypes.find((e) => e.key === inc.key);
                  return (
                    <InclusionCard
                      key={inc.key}
                      inclusion={inc}
                      displayName={et?.displayName ?? inc.key}
                      typeId={et?.entityTypeId ?? ''}
                      ownerType="entity-types"
                      onRemove={handleRemoveEntityType}
                      onUpdateProperties={handleUpdateEntityTypeScope}
                    />
                  );
                })}
              </div>
            )}
            {availableEntityTypes.length > 0 && (
              <AddTypeDropdown
                label="Add entity type"
                items={availableEntityTypes.map((et) => ({ key: et.key, label: `${et.displayName} (${et.key})` }))}
                onAdd={handleAddEntityType}
              />
            )}
          </section>

          {/* Relation Type Inclusions */}
          <section>
            <h3 className="text-lg font-semibold text-gray-800 mb-3">Included Relation Types</h3>
            {includedRelationTypes.length === 0 ? (
              <p className="text-gray-400 text-sm italic mb-3">
                {includedEntityTypes.length > 0
                  ? 'No relation types included (auto-filtered by entity scope).'
                  : 'No relation types included (all are visible).'}
              </p>
            ) : (
              <div className="space-y-2 mb-3">
                {includedRelationTypes.map((inc) => {
                  const rt = allRelationTypes.find((r) => r.key === inc.key);
                  return (
                    <InclusionCard
                      key={inc.key}
                      inclusion={inc}
                      displayName={rt?.displayName ?? inc.key}
                      typeId={rt?.relationTypeId ?? ''}
                      ownerType="relation-types"
                      onRemove={handleRemoveRelationType}
                      onUpdateProperties={handleUpdateRelationTypeScope}
                    />
                  );
                })}
              </div>
            )}
            {availableRelationTypes.length > 0 && (
              <AddTypeDropdown
                label="Add relation type"
                items={availableRelationTypes.map((rt) => ({ key: rt.key, label: `${rt.displayName} (${rt.key})` }))}
                onAdd={handleAddRelationType}
              />
            )}
          </section>
        </>
      )}

      {activeTab === 'diagram' && (
        schemaLoading ? (
          <p className="text-gray-400 text-sm">Loading schema...</p>
        ) : runtimeSchema ? (
          <ScopedOntologyGraph schema={runtimeSchema} />
        ) : (
          <p className="text-gray-400 text-sm italic">Schema not available. Validate the ontology scope first.</p>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InclusionCard — expandable row with property scoping
// ---------------------------------------------------------------------------

function InclusionCard({ inclusion, displayName, typeId, ownerType, onRemove, onUpdateProperties }: {
  inclusion: IncludeTypeResponse;
  displayName: string;
  typeId: string;
  ownerType: 'entity-types' | 'relation-types';
  onRemove: (typeId: string) => void;
  onUpdateProperties: (typeId: string, properties: string[] | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [allProperties, setAllProperties] = useState<PropertyDefinition[]>([]);
  const [loadingProps, setLoadingProps] = useState(false);
  const [saving, setSaving] = useState(false);

  // Local state for the property selection while editing
  const isAllProperties = inclusion.properties === null;
  const [useExplicitList, setUseExplicitList] = useState(!isAllProperties);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(inclusion.properties ?? []),
  );

  // Sync local state when inclusion changes from server
  useEffect(() => {
    setUseExplicitList(inclusion.properties !== null);
    setSelectedKeys(new Set(inclusion.properties ?? []));
  }, [inclusion.properties]);

  // Load properties when expanded
  useEffect(() => {
    if (!expanded || !typeId) return;
    let cancelled = false;
    setLoadingProps(true);
    api.listProperties(ownerType, typeId)
      .then((props) => { if (!cancelled) setAllProperties(props); })
      .catch(() => { if (!cancelled) setAllProperties([]); })
      .finally(() => { if (!cancelled) setLoadingProps(false); });
    return () => { cancelled = true; };
  }, [expanded, typeId, ownerType]);

  const handleToggleAll = () => {
    if (useExplicitList) {
      // Switch to "all properties"
      setUseExplicitList(false);
      setSelectedKeys(new Set());
    } else {
      // Switch to explicit list — start with all checked
      setUseExplicitList(true);
      setSelectedKeys(new Set(allProperties.map((p) => p.key)));
    }
  };

  const handleToggleProperty = (key: string, prop: PropertyDefinition) => {
    // Don't allow unchecking required properties without defaults
    if (selectedKeys.has(key) && prop.required && !prop.defaultValue) return;

    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const properties = useExplicitList ? Array.from(selectedKeys) : null;
      onUpdateProperties(typeId, properties);
    } finally {
      setSaving(false);
    }
  };

  // Determine if there are unsaved changes
  const currentServerValue = inclusion.properties;
  const localValue = useExplicitList ? Array.from(selectedKeys).sort() : null;
  const serverValue = currentServerValue ? [...currentServerValue].sort() : null;
  const hasChanges = localValue === null && serverValue !== null
    || localValue !== null && serverValue === null
    || (localValue !== null && serverValue !== null && JSON.stringify(localValue) !== JSON.stringify(serverValue));

  const propertyLabel = inclusion.properties === null
    ? 'all properties'
    : `${inclusion.properties.length} propert${inclusion.properties.length === 1 ? 'y' : 'ies'}`;

  return (
    <div className="bg-white border rounded-lg overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between p-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left flex-1 min-w-0"
        >
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-gray-900 truncate">{displayName}</span>
          <span className="text-sm text-gray-400 font-mono shrink-0">{inclusion.key}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
            inclusion.properties === null
              ? 'bg-gray-100 text-gray-500'
              : 'bg-blue-50 text-blue-600'
          }`}>
            {propertyLabel}
          </span>
        </button>
        <button
          onClick={() => onRemove(typeId)}
          className="text-sm text-red-600 hover:text-red-800 shrink-0 ml-2"
        >
          Remove
        </button>
      </div>

      {/* Expanded property panel */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
          {loadingProps ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              Loading properties...
            </div>
          ) : allProperties.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No properties defined on this type.</p>
          ) : (
            <>
              {/* Toggle between all / select */}
              <div className="flex items-center justify-between mb-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!useExplicitList}
                    onChange={handleToggleAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className={!useExplicitList ? 'font-medium text-gray-900' : 'text-gray-600'}>
                    All properties
                  </span>
                </label>
                {!useExplicitList && (
                  <span className="text-xs text-gray-400">
                    Reflects schema changes automatically
                  </span>
                )}
              </div>

              {/* Property checkboxes (shown when explicit list is active) */}
              {useExplicitList && (
                <div className="space-y-1.5 mb-3">
                  {allProperties.map((prop) => {
                    const checked = selectedKeys.has(prop.key);
                    const isRequiredNoDefault = prop.required && !prop.defaultValue;
                    const disabled = isRequiredNoDefault && checked;
                    return (
                      <label
                        key={prop.key}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${
                          disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-white'
                        }`}
                        title={disabled ? 'Required property without default — must be included' : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleProperty(prop.key, prop)}
                          disabled={disabled}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                        />
                        <span className={checked ? 'text-gray-900' : 'text-gray-400'}>
                          {prop.displayName}
                        </span>
                        <span className="text-xs text-gray-400 font-mono">{prop.key}</span>
                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{prop.dataType}</span>
                        {prop.required && (
                          <span className="text-xs font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                            required
                          </span>
                        )}
                        {prop.defaultValue !== null && (
                          <span className="text-xs text-gray-400">
                            default: {prop.defaultValue}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Save button (only shown when there are changes) */}
              {hasChanges && (
                <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setUseExplicitList(inclusion.properties !== null);
                      setSelectedKeys(new Set(inclusion.properties ?? []));
                    }}
                    className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
                  >
                    Reset
                  </button>
                  <span className="text-xs text-gray-400">Unsaved changes</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddTypeDropdown
// ---------------------------------------------------------------------------

function AddTypeDropdown({ label, items, onAdd }: {
  label: string;
  items: { key: string; label: string }[];
  onAdd: (key: string) => void;
}) {
  const [selected, setSelected] = useState('');

  const handleAdd = () => {
    if (selected) {
      onAdd(selected);
      setSelected('');
    }
  };

  return (
    <div className="flex gap-2">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="border border-gray-300 rounded px-3 py-1.5 text-sm flex-1"
      >
        <option value="">{label}...</option>
        {items.map((item) => (
          <option key={item.key} value={item.key}>{item.label}</option>
        ))}
      </select>
      <button
        onClick={handleAdd}
        disabled={!selected}
        className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
      >
        Add
      </button>
    </div>
  );
}
