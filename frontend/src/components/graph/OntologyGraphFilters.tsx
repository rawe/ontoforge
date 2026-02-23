import type { EntityType, RelationType } from '../../types/models';

interface Props {
  entityTypes: EntityType[];
  relationTypes: RelationType[];
  visibleEntityTypes: Set<string>;
  visibleRelationTypes: Set<string>;
  onToggleEntityType: (id: string) => void;
  onToggleRelationType: (id: string) => void;
  onShowAllEntities: () => void;
  onHideAllEntities: () => void;
  onShowAllRelations: () => void;
  onHideAllRelations: () => void;
}

export default function OntologyGraphFilters({
  entityTypes,
  relationTypes,
  visibleEntityTypes,
  visibleRelationTypes,
  onToggleEntityType,
  onToggleRelationType,
  onShowAllEntities,
  onHideAllEntities,
  onShowAllRelations,
  onHideAllRelations,
}: Props) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 space-y-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-gray-500 font-medium w-24 shrink-0">Entity Types:</span>
        {entityTypes.map((et) => (
          <button
            key={et.entityTypeId}
            onClick={() => onToggleEntityType(et.entityTypeId)}
            className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
              visibleEntityTypes.has(et.entityTypeId)
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {et.displayName}
          </button>
        ))}
        <button onClick={onShowAllEntities} className="text-xs text-blue-600 hover:underline ml-1">
          All
        </button>
        <button onClick={onHideAllEntities} className="text-xs text-blue-600 hover:underline">
          None
        </button>
      </div>
      {relationTypes.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-gray-500 font-medium w-24 shrink-0">Relations:</span>
          {relationTypes.map((rt) => (
            <button
              key={rt.relationTypeId}
              onClick={() => onToggleRelationType(rt.relationTypeId)}
              className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                visibleRelationTypes.has(rt.relationTypeId)
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {rt.displayName}
            </button>
          ))}
          <button onClick={onShowAllRelations} className="text-xs text-blue-600 hover:underline ml-1">
            All
          </button>
          <button onClick={onHideAllRelations} className="text-xs text-blue-600 hover:underline">
            None
          </button>
        </div>
      )}
    </div>
  );
}
