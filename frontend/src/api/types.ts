/**
 * Wire types for the OntoForge server.
 * Field names are the exact camelCase wire names — see the API contract.
 * Everything is scoped to one ontology (addressed by KEY); within it,
 * runtime addresses by lens/type KEY, modeling by UUID.
 */

/* ----------------------------------- misc ---------------------------------- */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface Features {
  searchStrategies: SearchStrategy[]
  semanticSearch: boolean
  ai: boolean
  entityIdentityComparison: boolean
  /** The storage adapter supports search indices (the Studio Search area). */
  searchIndices: boolean
}

export interface EntityIdentityComparison {
  decision: 'same' | 'different' | 'insufficient'
  probabilities: { same: number; different: number; insufficient: number }
  confidence: number
  truncatedFields: string[]
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
  /** Key of the string property that names instances; null when the lens hides it. */
  nameProperty: string | null
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
  type: 'oql' | 'search'
  /** OQL text — `oql` steps only. */
  oql?: string
  entityTypeKey?: string
  /** Semantic-search text — `search` steps only. */
  query?: string
  limit?: number
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

export type SearchStrategy = 'semantic' | 'keyword' | 'keyword-any' | 'keyword-all' | 'hybrid'
export type SearchKind = 'properties' | 'document'
export interface SearchEvidence {
  /** Original (1 + cosine) / 2 measurement, not confidence; null is unmeasured. */
  semanticSimilarity: number | null
  /** True for a native keyword match; null is unknown, including limited-list absence. */
  keywordMatch: boolean | null
  /** The entry's keyword score: distinct query words matched plus, as a fraction below
   * one, the native full-text rank (docs/capabilities/search.md#ranking). A number exactly
   * when keywordMatch is true; no fixed upper bound; not comparable to semanticSimilarity. */
  keywordScore: number | null
}
export type SearchMatch = {
  kind: 'properties'; evidence: SearchEvidence
} | {
  kind: 'document'; propertyKey: string; charOffset: number; charLength: number; evidence: SearchEvidence
}
export interface SearchHit {
  entity: EntityInstance
  /** 1.0 for the best hit; comparable only within this response.
   * One unfused ranking uses source scores; hybrid sums reciprocal ranks.
   * Cross-kind fusion uses the best rank contribution for multiple searched types,
   * and sum for one searched type. Cross-type ties prefer best returned similarity
   * only when all tied hits have a measurement; otherwise they stay stable.
   * A tie does not prove equal relevance.
   * Never indicates confidence or whether the best hit is good.
   */
  relativeScore: number
  matches: SearchMatch[]
  /** The entry the hit was found by. Absent from servers without search indices. */
  matched?: Matched
}

/** Which entry of which search index a hit was found by. */
export interface Matched {
  index: string
  partKind: 'self' | 'relation' | 'passage'
  /** Relation parts only. */
  relationType: string | null
  relationId: string | null
  /** The entity on the other end of a relation part. */
  target: { id: string; type: string; label: string | null } | null
  /** At most 200 characters of the matched entry text. */
  snippet: string
  /** Passages only. */
  charOffset: number | null
  charLength: number | null
}
export interface SearchResponse {
  query: string
  type: string | null
  in: SearchKind[]
  strategy: SearchStrategy
  /** The applied similarity floor on the `semanticSimilarity` scale; null when none was set. */
  minSimilarity: number | null
  filter: Record<string, string>
  hits: SearchHit[]
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
  callId: string
  tool: string
  args: Record<string, unknown>
  result?: unknown
  status: 'pending' | 'completed' | 'interrupted'
}

/* --------------------------------- registry --------------------------------- */

export interface Ontology {
  ontologyId: string
  key: string
  /** Mutable server-wide-unique display name; `null` when never named. */
  displayName: string | null
  createdAt: string
  updatedAt: string
}

export interface OntologyCreateInput {
  /** Immutable, server-wide unique; snake_case, max 59 chars. */
  key: string
  /** Optional — an ontology starts nameless unless one is chosen here. */
  displayName?: string
}

/** Rename touches the display name only; the key is immutable. */
export interface OntologyRenameInput {
  displayName: string
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
  /** Key of the string property that names instances — never null in modeling. */
  nameProperty: string
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
  /** Findings that do not make the result invalid (lens validation). */
  warnings?: ValidationError[]
}

/* ------------------------------ search indices ------------------------------ */

export type Representation = 'semantic' | 'keyword'
export type IndexKind = 'default' | 'passage' | 'custom'
export type RelationDirection = 'outgoing' | 'incoming'
export type KeywordLanguage = 'german' | 'english'

/** One relation type in one direction: relation fields plus the fields of
 * the entity on the other end, keyed by that entity's type. */
export interface SearchIndexRelationGroup {
  relationType: string
  direction: RelationDirection
  fields: string[]
  target: Record<string, string[]>
  /** Null: the relation type's display name. */
  label: string | null
  template: string | null
}

/**
 * A search index definition. `header` null = the root type's name
 * property; `[]` = no header. Managed indices (`<type>~default`,
 * `<type>~<documentProperty>`) are derived by the server and only switched.
 */
export interface SearchIndexDefinition {
  key: string
  name: string
  description: string
  entityType: string
  fields: string[]
  header: string[] | null
  relations: SearchIndexRelationGroup[]
  semantic: { enabled: boolean; template: string | null }
  keyword: { enabled: boolean }
}

export type IndexState = 'ready' | 'building' | 'stale' | 'failed' | 'disabled' | 'unavailable'

export interface RepresentationStatus {
  representation: Representation
  /** `unavailable` = semantic without an embedding provider. */
  state: Exclude<IndexState, 'disabled'>
  /** Progress of a building generation (0/0 when ready). */
  done: number
  total: number
  /** Queued items on the active generation (stale when > 0). */
  pending: number
  /** Items that exhausted their retries. */
  failed: number
}

export interface IndexStatus {
  /** Worst of the representations; `disabled` = managed index switched off. */
  state: IndexState
  representations: RepresentationStatus[]
  lastErrors: { entityId: string; partKind: string; message: string; at: string }[]
}

export interface SearchIndexRecord {
  key: string
  kind: IndexKind
  /** Custom indices are always enabled. */
  enabled: boolean
  definition: SearchIndexDefinition
  documentProperty: string | null
  status: IndexStatus
  createdAt: string
  updatedAt: string
}

export interface CostEstimate {
  entities: number
  entries: number
  seconds: number
  perRepresentation: {
    representation: Representation
    entries: number
    seconds: number
    /** False: a default rate, the throughput was not measured yet. */
    measured: boolean
  }[]
}

export interface SearchIndexPreview {
  valid: boolean
  issues: ValidationError[]
  /** Null when the draft is invalid. */
  estimate: CostEstimate | null
}

export interface SearchSettings {
  keywordLanguages: KeywordLanguage[]
  /** Managed index keys switched off. */
  disabledIndices: string[]
}

/** A search index included in a scoped lens. */
export interface SearchIndexInclude {
  key: string
}

/** One index of a lens's runtime search catalog (the indices the lens can search). */
export interface SearchCatalogEntry {
  key: string
  kind: IndexKind
  name: string
  description: string
  entityType: string
  fields: string[]
  relations: { relationType: string; direction: RelationDirection; label: string | null }[]
  documentProperty: string | null
  modes: Representation[]
  status: IndexState
}

/** A definition sent to preview: `key` may be absent for a new index. */
export type SearchIndexDraftInput = Omit<SearchIndexDefinition, 'key'> & { key?: string }

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
  /**
   * Create: key of the string property the server creates as the name
   * property (default `name`). Update: reassign to another string property.
   */
  nameProperty?: string
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
  'get_document',
  'list_relations',
  'get_neighbors',
  'search',
  'search_documents',
  'execute_query',
  'list_saved_queries',
  'search_saved_queries',
  'run_saved_query',
] as const
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number]
