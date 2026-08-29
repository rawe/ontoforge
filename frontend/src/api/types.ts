/**
 * Wire types for the OntoForge server.
 * Field names are the exact camelCase wire names — see the API contract.
 * Runtime addresses by lens/type KEY, modeling by UUID.
 */

/* ----------------------------------- misc ---------------------------------- */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface Features {
  semanticSearch: boolean
  ai: boolean
}

export type DataType =
  | 'string'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'document'

/**
 * Document property values never appear inline in entity reads — every read
 * (list, detail, neighbors, search, OQL query) replaces them with this stub.
 * Full content is fetched via the document endpoint (`getDocument`).
 */
export interface DocumentStub {
  document: true
  /** Character count of the full document. */
  length: number
}

export interface ListResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

/* ----------------------------- runtime — schema ----------------------------- */

export interface SchemaProperty {
  key: string
  displayName: string
  description: string | null
  dataType: DataType
  required: boolean
  defaultValue: JsonPrimitive | null
}

export interface SchemaEntityType {
  key: string
  displayName: string
  description: string | null
  properties: SchemaProperty[]
}

export interface SchemaRelationType {
  key: string
  displayName: string
  description: string | null
  fromEntityTypeKey: string
  toEntityTypeKey: string
  properties: SchemaProperty[]
}

export interface SavedQueryStep {
  name: string
  type: 'oql' | 'semantic_search'
  /** OQL text — `oql` steps only. */
  oql?: string
  entityTypeKey?: string
  /** Semantic-search text — `semantic_search` steps only. */
  query?: string
  limit?: number
  minScore?: number
  bindings?: Record<string, string>
}

export interface SavedQueryParameter {
  name: string
  description: string | null
  dataType: DataType
}

export interface SavedQuery {
  key: string
  name: string
  description: string | null
  steps: SavedQueryStep[]
  parameters: SavedQueryParameter[]
}

/**
 * A hit from semantic saved-query search. Discovery search deliberately
 * returns the query *without* its steps (only key, name, description,
 * parameters and a relevance score) — see docs/capabilities/saved-queries.md,
 * "Discovery". Use the full listing when steps are needed.
 */
export interface SavedQuerySearchHit {
  key: string
  name: string
  description: string | null
  parameters: SavedQueryParameter[]
  score: number
}

export interface AiAgent {
  key: string
  name: string
  description: string | null
  systemPrompt?: string | null
  /** null = all tools */
  tools?: string[] | null
}

export interface SchemaLens {
  key: string
  name: string
  description: string | null
  /** null = unscoped (full schema visible) */
  includes: { entityTypes?: unknown; relationTypes?: unknown } | null
  aiAgents: AiAgent[]
  savedQueries: SavedQuery[]
}

export interface RuntimeSchema {
  lens: SchemaLens
  entityTypes: SchemaEntityType[]
  relationTypes: SchemaRelationType[]
}

/* ---------------------------- runtime — instances ---------------------------- */

export interface EntityInstance {
  _id: string
  _entityTypeKey: string
  _createdAt: string
  _updatedAt: string
  [property: string]: JsonValue
}

export interface RelationInstance {
  _id: string
  _relationTypeKey: string
  _createdAt: string
  _updatedAt: string
  fromEntityId: string
  toEntityId: string
  [property: string]: JsonValue
}

export type NeighborDirection = 'outgoing' | 'incoming' | 'both'

export interface NeighborRelation extends RelationInstance {
  direction: 'outgoing' | 'incoming'
}

export interface Neighbor {
  relation: NeighborRelation
  entity: EntityInstance
}

export interface NeighborsResponse {
  entity: EntityInstance
  neighbors: Neighbor[]
}

/* ------------------------------ runtime — search ----------------------------- */

/**
 * How a semantic hit matched. `similarity` is the raw cosine of the winning
 * vector — use it for any display or threshold. Document matches also carry
 * the property key, character coordinates and (unless disabled) a snippet.
 */
export interface SearchMatchedVia {
  source: 'entity' | 'document'
  similarity: number
  propertyKey?: string
  charOffset?: number
  charLength?: number
  snippet?: string
}

export interface SemanticSearchResult {
  entity: EntityInstance
  /**
   * RRF fusion score — ordering only (small values like 0.016). For a
   * user-facing similarity use `matchedVia.similarity`.
   */
  score: number
  matchedVia?: SearchMatchedVia
}

export interface SemanticSearchResponse {
  results: SemanticSearchResult[]
  query: string
  total: number
}

/* ----------------------------- runtime — documents ---------------------------- */

/** Slice of a document property (`length` = actual returned characters). */
export interface DocumentContentResponse {
  propertyKey: string
  content: string
  offset: number
  length: number
  totalLength: number
}

/* ------------------------------ runtime — query ------------------------------ */

export interface QueryResult {
  columns: string[]
  results: Record<string, JsonValue>[]
}

/* -------------------------------- runtime — AI ------------------------------- */

export interface AiQueryResponse {
  answer: string
  /** The generated OQL query, when the AI ran one. */
  query: string | null
  results: QueryResult | null
}

export interface ExtractedEntity {
  entityTypeKey: string
  properties: Record<string, JsonValue>
}

export interface ExtractedRelationEndpoint {
  entityTypeKey: string
  match: Record<string, JsonValue>
}

export interface ExtractedRelation {
  relationTypeKey: string
  source: ExtractedRelationEndpoint
  target: ExtractedRelationEndpoint
  properties: Record<string, JsonValue>
}

export interface ExtractResponse {
  entities: ExtractedEntity[]
  relations: ExtractedRelation[]
  created: boolean
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ToolCall {
  tool: string
  args: Record<string, JsonValue>
}

export interface ChatResponse {
  reply: string
  toolCalls: ToolCall[] | null
}

/* --------------------------------- modeling --------------------------------- */

export interface Lens {
  lensId: string
  key: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface EntityType {
  entityTypeId: string
  key: string
  displayName: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface RelationType {
  relationTypeId: string
  key: string
  displayName: string
  description: string | null
  sourceEntityTypeKey: string
  targetEntityTypeKey: string
  createdAt: string
  updatedAt: string
}

export interface PropertyDefinition {
  propertyId: string
  key: string
  displayName: string
  description: string | null
  dataType: DataType
  required: boolean
  defaultValue: JsonPrimitive | null
}

/** Scope include item — `properties: null` means "all properties". */
export interface ScopeInclude {
  key: string
  properties: string[] | null
}

export interface ValidationError {
  path: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

/* ------------------------------ modeling inputs ------------------------------ */

export interface LensInput {
  key?: string
  name: string
  description?: string | null
}

export interface EntityTypeInput {
  key?: string
  displayName: string
  description?: string | null
}

export interface RelationTypeInput {
  key?: string
  displayName: string
  description?: string | null
  sourceEntityTypeKey?: string
  targetEntityTypeKey?: string
}

export interface PropertyInput {
  key?: string
  displayName: string
  description?: string | null
  dataType?: DataType
  required?: boolean
  defaultValue?: JsonPrimitive | null
}

export interface AiAgentInput {
  name: string
  description?: string | null
  systemPrompt?: string | null
  tools?: string[] | null
}

export interface SavedQueryInput {
  name: string
  description?: string | null
  steps: SavedQueryStep[]
  parameters?: SavedQueryParameter[]
}

/** Runtime tool names an agent may be restricted to. */
export const AGENT_TOOL_NAMES = [
  'get_schema',
  'list_entities',
  'get_entity',
  'list_relations',
  'get_neighbors',
  'semantic_search',
  'execute_query',
  'list_saved_queries',
  'search_saved_queries',
  'run_saved_query',
] as const
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number]
