// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

export type DataType =
  | 'string'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'datetime';

export interface PropertyDef {
  key: string;
  displayName: string;
  description: string | null;
  dataType: DataType;
  required: boolean;
  defaultValue: string | null;
}

export interface EntityType {
  key: string;
  displayName: string;
  description: string | null;
  properties: PropertyDef[];
}

export interface RelationType {
  key: string;
  displayName: string;
  description: string | null;
  fromEntityTypeKey: string;
  toEntityTypeKey: string;
  properties: PropertyDef[];
}

export interface RuntimeSchema {
  ontology: {
    name: string;
    key: string;
    description: string | null;
  };
  entityTypes: EntityType[];
  relationTypes: RelationType[];
}

// ---------------------------------------------------------------------------
// Instance types
// ---------------------------------------------------------------------------

export interface EntityInstance {
  _id: string;
  _entityTypeKey: string;
  _createdAt: string;
  _updatedAt: string;
  [key: string]: unknown;
}

export interface RelationInstance {
  _id: string;
  _relationTypeKey: string;
  _createdAt: string;
  _updatedAt: string;
  fromEntityId: string;
  toEntityId: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Graph traversal
// ---------------------------------------------------------------------------

export interface NeighborRelation {
  _id: string;
  _relationTypeKey: string;
  direction: 'outgoing' | 'incoming';
  [key: string]: unknown;
}

export interface NeighborEntry {
  relation: NeighborRelation;
  entity: EntityInstance;
}

export interface NeighborhoodResponse {
  entity: EntityInstance;
  neighbors: NeighborEntry[];
}

// ---------------------------------------------------------------------------
// Semantic search
// ---------------------------------------------------------------------------

export interface SemanticSearchResult {
  entity: EntityInstance;
  score: number;
}

export interface SemanticSearchResponse {
  results: SemanticSearchResult[];
  query: string;
  total: number;
}

// ---------------------------------------------------------------------------
// Cypher query
// ---------------------------------------------------------------------------

export interface CypherQueryResult {
  columns: string[];
  results: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Feature discovery
// ---------------------------------------------------------------------------

export interface FeaturesResponse {
  semanticSearch: boolean;
}

// ---------------------------------------------------------------------------
// Parameter types (for client method options)
// ---------------------------------------------------------------------------

/** Shared filter syntax: `{ "age__gt": "25", "name": "Alice" }` */
export type Filters = Record<string, string>;

export interface ListEntityParams {
  limit?: number;
  offset?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  q?: string;
  filters?: Filters;
  fields?: string[];
}

export interface ListRelationParams {
  limit?: number;
  offset?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  fromEntityId?: string;
  toEntityId?: string;
  filters?: Filters;
}

export interface NeighborParams {
  relationTypeKey?: string;
  direction?: 'outgoing' | 'incoming' | 'both';
  limit?: number;
  fields?: string[];
  relationFields?: string[];
}

export interface SemanticSearchParams {
  q: string;
  type: string;
  limit?: number;
  minScore?: number;
  filters?: Filters;
  fields?: string[];
}

export interface GetEntityParams {
  fields?: string[];
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

export interface ClientOptions {
  /** Base URL of the OntoForge server (e.g. `"http://localhost:8000"`). */
  baseUrl: string;

  /** Default ontology key. Can be overridden per method call. */
  ontology?: string;

  /** Custom fetch implementation for testing or middleware. Defaults to global `fetch`. */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/** Per-method option to override the default ontology. */
export interface OntologyOverride {
  ontology?: string;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type OntoForgeErrorCode =
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_CONFLICT'
  | 'VALIDATION_ERROR'
  | 'CASCADE_REQUIRED'
  | 'INVALID_JSON'
  | 'FEATURE_DISABLED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export interface ErrorDetails {
  fields?: Record<string, string>;
  errors?: string[];
  affectedOntologies?: string[];
  [key: string]: unknown;
}
