import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EntityType, RelationType, PropertyDefinition } from '../../types/models';
import { listProperties } from '../../api/client';

interface EntitySelection {
  kind: 'entity';
  entityType: EntityType;
}

interface RelationSelection {
  kind: 'relation';
  relationType: RelationType;
}

export type GraphSelection = EntitySelection | RelationSelection;

interface Props {
  selection: GraphSelection;
  ontologyId: string;
  entityTypes: EntityType[];
  onClose: () => void;
}

export default function GraphDetailPanel({ selection, ontologyId, entityTypes, onClose }: Props) {
  const [properties, setProperties] = useState<PropertyDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ownerType = selection.kind === 'entity' ? 'entity-types' : 'relation-types';
  const ownerId =
    selection.kind === 'entity'
      ? selection.entityType.entityTypeId
      : selection.relationType.relationTypeId;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listProperties(ontologyId, ownerType as 'entity-types' | 'relation-types', ownerId)
      .then((props) => {
        if (!cancelled) setProperties(props);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load properties');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ontologyId, ownerType, ownerId]);

  const editPath =
    selection.kind === 'entity'
      ? `/ontologies/${ontologyId}/entity-types/${selection.entityType.entityTypeId}`
      : `/ontologies/${ontologyId}/relation-types/${selection.relationType.relationTypeId}`;

  const displayName =
    selection.kind === 'entity'
      ? selection.entityType.displayName
      : selection.relationType.displayName;

  const key =
    selection.kind === 'entity' ? selection.entityType.key : selection.relationType.key;

  const description =
    selection.kind === 'entity'
      ? selection.entityType.description
      : selection.relationType.description;

  const sourceName =
    selection.kind === 'relation'
      ? entityTypes.find((et) => et.entityTypeId === selection.relationType.sourceEntityTypeId)
          ?.displayName ?? 'Unknown'
      : null;

  const targetName =
    selection.kind === 'relation'
      ? entityTypes.find((et) => et.entityTypeId === selection.relationType.targetEntityTypeId)
          ?.displayName ?? 'Unknown'
      : null;

  return (
    <div className="w-80 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
          {selection.kind === 'entity' ? 'Entity Type' : 'Relation Type'}
        </span>
        <div className="flex items-center gap-2">
          <Link
            to={editPath}
            className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
          >
            Edit
          </Link>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            aria-label="Close panel"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Name and key */}
        <div>
          <h3 className="text-base font-semibold text-gray-900">{displayName}</h3>
          <p className="text-xs text-gray-400 font-mono mt-0.5">{key}</p>
        </div>

        {/* Description */}
        {description && (
          <p className="text-sm text-gray-600">{description}</p>
        )}

        {/* Source/Target for relations */}
        {selection.kind === 'relation' && (
          <div className="text-sm">
            <span className="text-gray-500">
              {sourceName}
            </span>
            <span className="mx-1.5 text-gray-400">&rarr;</span>
            <span className="text-gray-500">
              {targetName}
            </span>
          </div>
        )}

        {/* Properties */}
        <div>
          <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            Properties
          </h4>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              Loading...
            </div>
          ) : error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : properties.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No properties defined</p>
          ) : (
            <ul className="space-y-2">
              {properties.map((prop) => (
                <li
                  key={prop.propertyId}
                  className="border border-gray-100 rounded-md px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">
                      {prop.displayName}
                    </span>
                    <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                      {prop.dataType}
                    </span>
                    {prop.required && (
                      <span className="text-xs font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                        required
                      </span>
                    )}
                  </div>
                  {prop.description && (
                    <p className="text-xs text-gray-500 mt-1">{prop.description}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
