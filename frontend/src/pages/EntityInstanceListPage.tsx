import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useRuntimeSchema } from '../hooks/useRuntimeSchema';
import { useFeatures } from '../hooks/useFeatures';
import * as runtimeApi from '../api/runtimeClient';
import { ApiError } from '../api/request';
import type { EntityInstance, RuntimeEntityType } from '../types/runtime';
import DataTable from '../components/runtime/DataTable';
import Pagination from '../components/runtime/Pagination';
import Modal from '../components/runtime/Modal';
import DynamicForm from '../components/runtime/DynamicForm';
import ConfirmDialog from '../components/ConfirmDialog';
import AutoRefreshToggle from '../components/AutoRefreshToggle';

const PAGE_LIMIT = 20;

export default function EntityInstanceListPage() {
  const { ontologyKey, entityTypeKey } = useParams<{ ontologyKey: string; entityTypeKey: string }>();
  const { data: schema, isLoading: schemaLoading } = useRuntimeSchema(ontologyKey);
  const { data: features } = useFeatures();

  const [items, setItems] = useState<EntityInstance[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sortKey, setSortKey] = useState('_createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);

  // Search state: searchInput is the live input value, submittedSearch is the active query
  const [searchInput, setSearchInput] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [searchMode, setSearchMode] = useState<'none' | 'basic' | 'semantic'>('none');

  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Modal state
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingInstance, setEditingInstance] = useState<EntityInstance | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const entityType: RuntimeEntityType | undefined = schema?.entityTypes.find(
    (et) => et.key === entityTypeKey,
  );

  const isSemanticSearch = searchMode === 'semantic';

  const load = useCallback(async () => {
    if (!ontologyKey || !entityTypeKey) return;
    setLoading(true);
    try {
      if (submittedSearch && features?.semanticSearch) {
        // Semantic search
        const res = await runtimeApi.semanticSearch(ontologyKey, {
          q: submittedSearch,
          type: entityTypeKey,
          limit: PAGE_LIMIT,
        });
        setItems(res.results.map((r) => r.entity));
        setTotal(res.total);
        setSearchMode('semantic');
      } else {
        // Regular list (with optional basic text search)
        const res = await runtimeApi.listEntities(ontologyKey, entityTypeKey, {
          limit: PAGE_LIMIT,
          offset,
          sort: sortKey,
          order: sortOrder,
          q: submittedSearch || undefined,
        });
        setItems(res.items);
        setTotal(res.total);
        setSearchMode(submittedSearch ? 'basic' : 'none');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load entities');
    } finally {
      setLoading(false);
    }
  }, [ontologyKey, entityTypeKey, offset, sortKey, sortOrder, submittedSearch, features?.semanticSearch]);

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

  const handleSearchSubmit = () => {
    const trimmed = searchInput.trim();
    setSubmittedSearch(trimmed);
    setOffset(0);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearchSubmit();
    }
  };

  const clearSearch = () => {
    setSearchInput('');
    setSubmittedSearch('');
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
        toast.error(e instanceof Error ? e.message : 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!ontologyKey || !entityTypeKey) return;
    try {
      await runtimeApi.deleteEntity(ontologyKey, entityTypeKey, id);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  if (schemaLoading) return <p>Loading schema...</p>;
  if (!entityType) return <p>Entity type not found.</p>;

  const columns = [
    ...entityType.properties.map((p) => ({ key: p.key, label: p.displayName, sortable: !isSemanticSearch })),
    { key: '_createdAt', label: 'Created', sortable: !isSemanticSearch },
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

      <div className="mb-4 flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search..."
            className="w-full px-3 py-2 pr-8 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {(searchInput || submittedSearch) && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
              title="Clear search"
            >
              &times;
            </button>
          )}
        </div>
        <button
          onClick={handleSearchSubmit}
          disabled={!searchInput.trim()}
          className="px-4 py-2 bg-gray-100 border border-gray-300 text-sm rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Search
        </button>
      </div>

      {submittedSearch && !loading && (
        <p className="text-xs text-gray-400 mb-2">
          {total} result{total !== 1 ? 's' : ''} for &ldquo;{submittedSearch}&rdquo;
          {searchMode !== 'none' && (
            <span className="ml-1 text-gray-400">({searchMode})</span>
          )}
        </p>
      )}

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={items}
            sortKey={isSemanticSearch ? undefined : sortKey}
            sortOrder={isSemanticSearch ? undefined : sortOrder}
            onSort={isSemanticSearch ? undefined : handleSort}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
          />
          {!isSemanticSearch && (
            <Pagination
              total={total}
              limit={PAGE_LIMIT}
              offset={offset}
              onChange={setOffset}
            />
          )}
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
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Entity"
        description="Delete this entity instance? Related relations will also be deleted."
        onConfirm={() => {
          if (deleteTarget) handleDelete(deleteTarget);
          setDeleteTarget(null);
        }}
      />
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
