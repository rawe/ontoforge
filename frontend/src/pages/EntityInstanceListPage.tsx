import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useRuntimeSchema } from '../context/RuntimeSchemaContext';
import * as runtimeApi from '../api/runtimeClient';
import { ApiError } from '../api/request';
import type { EntityInstance, RuntimeEntityType } from '../types/runtime';
import DataTable from '../components/runtime/DataTable';
import Pagination from '../components/runtime/Pagination';
import Modal from '../components/runtime/Modal';
import DynamicForm from '../components/runtime/DynamicForm';

const PAGE_LIMIT = 20;

export default function EntityInstanceListPage() {
  const { ontologyKey, entityTypeKey } = useParams<{ ontologyKey: string; entityTypeKey: string }>();
  const { schema, loading: schemaLoading } = useRuntimeSchema();

  const [items, setItems] = useState<EntityInstance[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sortKey, setSortKey] = useState('_createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingInstance, setEditingInstance] = useState<EntityInstance | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const entityType: RuntimeEntityType | undefined = schema?.entityTypes.find(
    (et) => et.key === entityTypeKey,
  );

  const load = useCallback(async () => {
    if (!ontologyKey || !entityTypeKey) return;
    setLoading(true);
    try {
      const res = await runtimeApi.listEntities(ontologyKey, entityTypeKey, {
        limit: PAGE_LIMIT,
        offset,
        sort: sortKey,
        order: sortOrder,
        q: search || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load entities');
    } finally {
      setLoading(false);
    }
  }, [ontologyKey, entityTypeKey, offset, sortKey, sortOrder, search]);

  useEffect(() => { load(); }, [load]);

  const handleSort = (key: string) => {
    if (key === sortKey) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
    setOffset(0);
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    setOffset(0);
  };

  const openCreate = () => {
    setEditingInstance(null);
    setFormErrors({});
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
  };

  const handleSubmit = async (values: Record<string, unknown>) => {
    if (!ontologyKey || !entityTypeKey) return;
    setSaving(true);
    setFormErrors({});
    try {
      if (modalMode === 'create') {
        await runtimeApi.createEntity(ontologyKey, entityTypeKey, values);
      } else if (modalMode === 'edit' && editingInstance) {
        await runtimeApi.updateEntity(ontologyKey, entityTypeKey, editingInstance._id, values);
      }
      closeModal();
      load();
    } catch (e) {
      if (e instanceof ApiError && e.details?.fields) {
        setFormErrors(e.details.fields as Record<string, string>);
      } else {
        alert(e instanceof Error ? e.message : 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!ontologyKey || !entityTypeKey) return;
    if (!confirm('Delete this entity instance? Related relations will also be deleted.')) return;
    try {
      await runtimeApi.deleteEntity(ontologyKey, entityTypeKey, id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  if (schemaLoading) return <p>Loading schema...</p>;
  if (!entityType) return <p>Entity type not found.</p>;

  const columns = [
    ...entityType.properties.map((p) => ({ key: p.key, label: p.displayName, sortable: true })),
    { key: '_createdAt', label: 'Created', sortable: true },
  ];

  return (
    <div>
      <Link to={`/data/${ontologyKey}`} className="text-blue-600 hover:underline text-sm">
        &larr; Back to data
      </Link>

      <div className="mt-4 mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{entityType.displayName}</h2>
          <p className="text-sm text-gray-400 font-mono">{entityType.key}</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          Create
        </button>
      </div>

      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search..."
          className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={items}
            sortKey={sortKey}
            sortOrder={sortOrder}
            onSort={handleSort}
            onEdit={openEdit}
            onDelete={handleDelete}
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
        title={modalMode === 'create' ? `Create ${entityType.displayName}` : `Edit ${entityType.displayName}`}
      >
        <DynamicForm
          properties={entityType.properties}
          initialValues={editingInstance ? extractUserProps(editingInstance) : undefined}
          onSubmit={handleSubmit}
          onCancel={closeModal}
          errors={formErrors}
          loading={saving}
        />
      </Modal>
    </div>
  );
}

function extractUserProps(instance: EntityInstance): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(instance)) {
    if (!key.startsWith('_')) result[key] = value;
  }
  return result;
}
