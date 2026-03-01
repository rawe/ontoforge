import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useRuntimeSchema } from '../hooks/useRuntimeSchema';
import * as runtimeApi from '../api/runtimeClient';
import { ApiError } from '../api/request';
import type { RelationInstance, RuntimeRelationType, EntityInstance } from '../types/runtime';
import DataTable from '../components/runtime/DataTable';
import Pagination from '../components/runtime/Pagination';
import Modal from '../components/runtime/Modal';
import DynamicForm from '../components/runtime/DynamicForm';
import EntityPicker from '../components/runtime/EntityPicker';
import ConfirmDialog from '../components/ConfirmDialog';
import AutoRefreshToggle from '../components/AutoRefreshToggle';

const PAGE_LIMIT = 20;

function getEntityDisplayLabel(entity: EntityInstance): string {
  for (const [key, val] of Object.entries(entity)) {
    if (key.startsWith('_')) continue;
    if (key === 'fromEntityId' || key === 'toEntityId') continue;
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return entity._id;
}

export default function RelationInstanceListPage() {
  const { ontologyKey, relationTypeKey } = useParams<{ ontologyKey: string; relationTypeKey: string }>();
  const { data: schema, isLoading: schemaLoading } = useRuntimeSchema(ontologyKey);

  const [items, setItems] = useState<RelationInstance[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sortKey, setSortKey] = useState('_createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);

  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Entity display label cache
  const [entityLabels, setEntityLabels] = useState<Map<string, string>>(new Map());

  // Modal state
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingInstance, setEditingInstance] = useState<RelationInstance | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [fromEntityId, setFromEntityId] = useState<string | null>(null);
  const [toEntityId, setToEntityId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const relationType: RuntimeRelationType | undefined = schema?.relationTypes.find(
    (rt) => rt.key === relationTypeKey,
  );

  const load = useCallback(async () => {
    if (!ontologyKey || !relationTypeKey) return;
    setLoading(true);
    try {
      const res = await runtimeApi.listRelations(ontologyKey, relationTypeKey, {
        limit: PAGE_LIMIT,
        offset,
        sort: sortKey,
        order: sortOrder,
      });
      setItems(res.items);
      setTotal(res.total);

      // Resolve entity display labels
      if (res.items.length > 0 && relationType) {
        resolveEntityLabels(ontologyKey, relationType, res.items);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load relations');
    } finally {
      setLoading(false);
    }
  }, [ontologyKey, relationTypeKey, offset, sortKey, sortOrder, relationType]);

  const resolveEntityLabels = async (
    okKey: string,
    rt: RuntimeRelationType,
    relations: RelationInstance[],
  ) => {
    const fromIds = new Set<string>();
    const toIds = new Set<string>();
    for (const rel of relations) {
      fromIds.add(rel.fromEntityId);
      toIds.add(rel.toEntityId);
    }

    const labels = new Map<string, string>();
    const fetches: Promise<void>[] = [];

    for (const id of fromIds) {
      fetches.push(
        runtimeApi.getEntity(okKey, rt.fromEntityTypeKey, id)
          .then((e) => { labels.set(id, getEntityDisplayLabel(e)); })
          .catch(() => { labels.set(id, id.slice(0, 8) + '...'); }),
      );
    }
    for (const id of toIds) {
      if (fromIds.has(id)) continue; // already fetching
      fetches.push(
        runtimeApi.getEntity(okKey, rt.toEntityTypeKey, id)
          .then((e) => { labels.set(id, getEntityDisplayLabel(e)); })
          .catch(() => { labels.set(id, id.slice(0, 8) + '...'); }),
      );
    }

    await Promise.all(fetches);
    setEntityLabels(labels);
  };

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(load, 3000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [autoRefresh, load]);

  const handleSort = (key: string) => {
    if (key === sortKey) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
    setOffset(0);
  };

  const openCreate = () => {
    setEditingInstance(null);
    setFormErrors({});
    setFromEntityId(null);
    setToEntityId(null);
    setModalMode('create');
  };

  const openEdit = (id: string) => {
    const instance = items.find((item) => item._id === id);
    if (!instance) return;
    setEditingInstance(instance);
    setFormErrors({});
    setModalMode('edit');
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingInstance(null);
    setFormErrors({});
    setFromEntityId(null);
    setToEntityId(null);
  };

  const handleSubmit = async (values: Record<string, unknown>) => {
    if (!ontologyKey || !relationTypeKey) return;
    setSaving(true);
    setFormErrors({});
    try {
      if (modalMode === 'create') {
        if (!fromEntityId || !toEntityId) {
          toast.error('Please select both From and To entities.');
          setSaving(false);
          return;
        }
        await runtimeApi.createRelation(ontologyKey, relationTypeKey, {
          fromEntityId,
          toEntityId,
          ...values,
        });
      } else if (modalMode === 'edit' && editingInstance) {
        await runtimeApi.updateRelation(ontologyKey, relationTypeKey, editingInstance._id, values);
      }
      closeModal();
      load();
    } catch (e) {
      if (e instanceof ApiError && e.details?.fields) {
        setFormErrors(e.details.fields as Record<string, string>);
      } else {
        toast.error(e instanceof Error ? e.message : 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!ontologyKey || !relationTypeKey) return;
    try {
      await runtimeApi.deleteRelation(ontologyKey, relationTypeKey, id);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  if (schemaLoading) return <p>Loading schema...</p>;
  if (!relationType) return <p>Relation type not found.</p>;

  // Build rows with resolved entity labels
  const rows = items.map((item) => ({
    ...item,
    _fromLabel: entityLabels.get(item.fromEntityId) ?? item.fromEntityId.slice(0, 8) + '...',
    _toLabel: entityLabels.get(item.toEntityId) ?? item.toEntityId.slice(0, 8) + '...',
  }));

  const columns = [
    { key: '_fromLabel', label: `From (${relationType.fromEntityTypeKey})`, sortable: false },
    { key: '_toLabel', label: `To (${relationType.toEntityTypeKey})`, sortable: false },
    ...relationType.properties.map((p) => ({ key: p.key, label: p.displayName, sortable: true })),
    { key: '_createdAt', label: 'Created', sortable: true },
  ];

  return (
    <div>
      <Link to={`/data/${ontologyKey}`} className="text-blue-600 hover:underline text-sm">
        &larr; Back to data
      </Link>

      <div className="mt-4 mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{relationType.displayName}</h2>
          <p className="text-sm text-gray-400 font-mono">{relationType.key}</p>
          <p className="text-xs text-gray-500 mt-1">
            {relationType.fromEntityTypeKey} &rarr; {relationType.toEntityTypeKey}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle enabled={autoRefresh} onToggle={setAutoRefresh} />
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            Create
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            sortKey={sortKey}
            sortOrder={sortOrder}
            onSort={handleSort}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
          />
          <Pagination
            total={total}
            limit={PAGE_LIMIT}
            offset={offset}
            onChange={setOffset}
          />
        </>
      )}

      <Modal
        open={modalMode !== null}
        onClose={closeModal}
        title={modalMode === 'create' ? `Create ${relationType.displayName}` : `Edit ${relationType.displayName}`}
      >
        <DynamicForm
          properties={relationType.properties}
          initialValues={editingInstance ? extractRelationProps(editingInstance) : undefined}
          onSubmit={handleSubmit}
          onCancel={closeModal}
          errors={formErrors}
          loading={saving}
        >
          {modalMode === 'create' && ontologyKey ? (
            <div className="space-y-4 mb-4 pb-4 border-b border-gray-200">
              <EntityPicker
                ontologyKey={ontologyKey}
                entityTypeKey={relationType.fromEntityTypeKey}
                value={fromEntityId}
                onChange={setFromEntityId}
                label={`From (${relationType.fromEntityTypeKey})`}
              />
              <EntityPicker
                ontologyKey={ontologyKey}
                entityTypeKey={relationType.toEntityTypeKey}
                value={toEntityId}
                onChange={setToEntityId}
                label={`To (${relationType.toEntityTypeKey})`}
              />
            </div>
          ) : modalMode === 'edit' && editingInstance ? (
            <div className="mb-4 pb-4 border-b border-gray-200 text-sm text-gray-600">
              <p><span className="font-medium">From:</span> {entityLabels.get(editingInstance.fromEntityId) ?? editingInstance.fromEntityId}</p>
              <p><span className="font-medium">To:</span> {entityLabels.get(editingInstance.toEntityId) ?? editingInstance.toEntityId}</p>
            </div>
          ) : null}
        </DynamicForm>
      </Modal>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Relation"
        description="Delete this relation instance?"
        onConfirm={() => {
          if (deleteTarget) handleDelete(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

function extractRelationProps(instance: RelationInstance): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(instance)) {
    if (key.startsWith('_') || key === 'fromEntityId' || key === 'toEntityId') continue;
    result[key] = value;
  }
  return result;
}
