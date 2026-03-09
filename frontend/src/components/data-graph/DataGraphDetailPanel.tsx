import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import type { EntityInstance, RelationInstance, RuntimeEntityType, RuntimeRelationType } from '../../types/runtime';
import * as runtimeApi from '../../api/runtimeClient';
import { getDisplayLabelKey } from '../../lib/displayLabel';
import DynamicForm from '../runtime/DynamicForm';
import Modal from '../Modal';
import ConfirmDialog from '../ConfirmDialog';

type Selection =
  | { kind: 'entity'; entity: EntityInstance; entityType: RuntimeEntityType }
  | {
      kind: 'relation';
      relation: RelationInstance;
      relationType: RuntimeRelationType;
      fromLabel: string;
      toLabel: string;
      fromEntityId: string;
      toEntityId: string;
      fromTypeName: string;
      toTypeName: string;
    };

interface Props {
  selection: Selection;
  ontologyKey: string;
  entityTypes: RuntimeEntityType[];
  entities: Map<string, EntityInstance>;
  onClose: () => void;
  onEntityUpdated: (entity: EntityInstance) => void;
  onEntityDeleted: (entityId: string) => void;
  onRelationDeleted: (relationId: string, relationTypeKey: string) => void;
  onAddNeighbors: (entityId: string, entityTypeKey: string) => void;
  onRemoveFromCanvas: (entityId: string) => void;
}

const LONG_VALUE_THRESHOLD = 40;

function isLongValue(value: unknown): boolean {
  if (value == null) return false;
  const str = String(value);
  return str.length >= LONG_VALUE_THRESHOLD || str.includes('\n');
}

function PropertyValue({ value, expanded, onToggle }: { value: unknown; expanded: boolean; onToggle: () => void }) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);

  const checkOverflow = useCallback(() => {
    const el = textRef.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, []);

  useEffect(() => {
    checkOverflow();
  }, [checkOverflow, value, expanded]);

  if (value == null) return <span className="text-gray-300 italic">null</span>;

  const str = String(value);
  const long = isLongValue(value);

  if (!long) {
    return <span className="text-gray-900 font-medium break-all">{str}</span>;
  }

  return (
    <div>
      <p
        ref={textRef}
        className={`text-gray-900 text-sm whitespace-pre-wrap break-words ${expanded ? '' : 'line-clamp-3'}`}
      >
        {str}
      </p>
      {(overflows || expanded) && (
        <button
          onClick={onToggle}
          className="text-xs text-blue-600 hover:text-blue-800 mt-0.5"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export default function DataGraphDetailPanel({
  selection,
  ontologyKey,
  onClose,
  onEntityUpdated,
  onEntityDeleted,
  onRelationDeleted,
  onAddNeighbors,
  onRemoveFromCanvas,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [expandedProps, setExpandedProps] = useState<Set<string>>(new Set());

  const toggleExpanded = (key: string) => {
    setExpandedProps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleEntityUpdate = async (values: Record<string, unknown>) => {
    if (selection.kind !== 'entity') return;
    setSaving(true);
    setFieldErrors({});
    try {
      const updated = await runtimeApi.updateEntity(
        ontologyKey,
        selection.entity._entityTypeKey,
        selection.entity._id,
        values,
      );
      onEntityUpdated(updated);
      setEditing(false);
      toast.success('Entity updated');
    } catch (e: unknown) {
      const err = e as { details?: { fields?: Record<string, string> }; message?: string };
      if (err.details?.fields) setFieldErrors(err.details.fields);
      else toast.error(err.message ?? 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (selection.kind === 'entity') {
      try {
        await runtimeApi.deleteEntity(ontologyKey, selection.entity._entityTypeKey, selection.entity._id);
        onEntityDeleted(selection.entity._id);
        toast.success('Entity deleted');
      } catch (e: unknown) {
        toast.error((e as Error).message ?? 'Delete failed');
      }
    } else {
      try {
        await runtimeApi.deleteRelation(ontologyKey, selection.relation._relationTypeKey, selection.relation._id);
        onRelationDeleted(selection.relation._id, selection.relation._relationTypeKey);
        toast.success('Relation deleted');
      } catch (e: unknown) {
        toast.error((e as Error).message ?? 'Delete failed');
      }
    }
  };

  const isEntity = selection.kind === 'entity';
  const properties = isEntity ? selection.entityType.properties : selection.relationType.properties;

  // Build property display values
  const instance = isEntity ? selection.entity : selection.relation;
  const propValues = properties.map((p) => ({
    key: p.key,
    displayName: p.displayName,
    dataType: p.dataType,
    value: instance[p.key],
  }));

  // Reorder: label property first, rest in original order
  const labelKey = isEntity ? getDisplayLabelKey(selection.entity) : null;
  const orderedProps = labelKey
    ? [...propValues.filter((p) => p.key === labelKey), ...propValues.filter((p) => p.key !== labelKey)]
    : propValues;

  return (
    <div className="w-[28rem] border-l border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
          {isEntity ? 'Entity' : 'Relation'}
        </span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          aria-label="Close panel"
        >
          &times;
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {isEntity ? (
          <>
            {/* Type badge + ID */}
            <div>
              <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                {selection.entityType.displayName}
              </span>
              <p className="text-[10px] text-gray-400 font-mono mt-1">{selection.entity._id}</p>
            </div>

            {/* Properties */}
            <div>
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Properties</h4>
              {orderedProps.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No properties</p>
              ) : (
                <ul className="space-y-2.5">
                  {orderedProps.map((p) => {
                    const long = isLongValue(p.value);
                    if (long) {
                      // Stacked layout: label on top, value below (collapsible)
                      return (
                        <li key={p.key}>
                          <span className="text-xs text-gray-500">{p.displayName}</span>
                          <div className="mt-0.5">
                            <PropertyValue
                              value={p.value}
                              expanded={expandedProps.has(p.key)}
                              onToggle={() => toggleExpanded(p.key)}
                            />
                          </div>
                        </li>
                      );
                    }
                    // Inline layout: label left, value right
                    return (
                      <li key={p.key} className="flex justify-between items-baseline text-sm gap-2">
                        <span className="text-gray-500 shrink-0">{p.displayName}</span>
                        <PropertyValue
                          value={p.value}
                          expanded={false}
                          onToggle={() => {}}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
              >
                Edit
              </button>
              <button
                onClick={() => onAddNeighbors(selection.entity._id, selection.entity._entityTypeKey)}
                className="px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100"
              >
                Add Neighbors
              </button>
              <button
                onClick={() => onRemoveFromCanvas(selection.entity._id)}
                className="px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-600 rounded hover:bg-gray-100"
              >
                Remove from Canvas
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 rounded hover:bg-red-100"
              >
                Delete
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <span className="text-xs font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">
                {selection.relationType.displayName}
              </span>
              <p className="text-[10px] text-gray-400 font-mono mt-1">{selection.relation._id}</p>
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span>From</span>
                  <span className="text-gray-300">&middot;</span>
                  <span>{selection.fromTypeName}</span>
                </div>
                <div className="text-sm font-medium text-gray-900 break-words mt-0.5">{selection.fromLabel}</div>
                <p className="text-[10px] text-gray-400 font-mono mt-0.5 break-all">{selection.fromEntityId}</p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span>To</span>
                  <span className="text-gray-300">&middot;</span>
                  <span>{selection.toTypeName}</span>
                </div>
                <div className="text-sm font-medium text-gray-900 break-words mt-0.5">{selection.toLabel}</div>
                <p className="text-[10px] text-gray-400 font-mono mt-0.5 break-all">{selection.toEntityId}</p>
              </div>
            </div>

            {/* Properties */}
            {propValues.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Properties</h4>
                <ul className="space-y-2.5">
                  {propValues.map((p) => {
                    const long = isLongValue(p.value);
                    if (long) {
                      return (
                        <li key={p.key}>
                          <span className="text-xs text-gray-500">{p.displayName}</span>
                          <div className="mt-0.5">
                            <PropertyValue
                              value={p.value}
                              expanded={expandedProps.has(p.key)}
                              onToggle={() => toggleExpanded(p.key)}
                            />
                          </div>
                        </li>
                      );
                    }
                    return (
                      <li key={p.key} className="flex justify-between items-baseline text-sm gap-2">
                        <span className="text-gray-500 shrink-0">{p.displayName}</span>
                        <PropertyValue
                          value={p.value}
                          expanded={false}
                          onToggle={() => {}}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="pt-2 border-t border-gray-100">
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 rounded hover:bg-red-100"
              >
                Delete Relation
              </button>
            </div>
          </>
        )}
      </div>

      {/* Edit modal for entities */}
      {isEntity && (
        <Modal open={editing} onClose={() => setEditing(false)} title="Edit Entity">
          <DynamicForm
            properties={selection.entityType.properties}
            initialValues={selection.entity}
            onSubmit={handleEntityUpdate}
            onCancel={() => setEditing(false)}
            errors={fieldErrors}
            loading={saving}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={isEntity ? 'Delete Entity' : 'Delete Relation'}
        description={
          isEntity
            ? 'This will permanently delete this entity and all its relations.'
            : 'This will permanently delete this relation.'
        }
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </div>
  );
}

export type { Selection as DataGraphSelection };
