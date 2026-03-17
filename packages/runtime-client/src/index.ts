export { OntoForgeRuntime } from './client.js';
export { OntoForgeError } from './errors.js';

export type {
  // Client configuration
  ClientOptions,
  OntologyOverride,

  // Schema
  DataType,
  PropertyDef,
  EntityType,
  RelationType,
  RuntimeSchema,

  // Instances
  EntityInstance,
  RelationInstance,
  PaginatedResponse,

  // Graph traversal
  NeighborRelation,
  NeighborEntry,
  NeighborhoodResponse,

  // Semantic search
  SemanticSearchResult,
  SemanticSearchResponse,

  // Cypher
  CypherQueryResult,

  // Features
  FeaturesResponse,

  // Method parameters
  Filters,
  ListEntityParams,
  ListRelationParams,
  NeighborParams,
  SemanticSearchParams,
  GetEntityParams,

  // Error types
  OntoForgeErrorCode,
  ErrorDetails,
} from './types.js';
