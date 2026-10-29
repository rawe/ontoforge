/**
 * Wire types for the OntoForge server.
 * Field names are the exact camelCase wire names — see the API contract.
 * Everything is scoped to one ontology (addressed by KEY); within it,
 * runtime addresses by lens/type KEY, modeling by UUID.
 */

/* ----------------------------------- misc ---------------------------------- */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface ServerInfo {
  /** Where clients reach the server; null when the deployment configures none. */
  baseUrl: string | null
  version: string
  /** Whether sign-in is required (a server before authentication omits it). */
  authentication?: boolean
}

export interface Features {
  searchStrategies: SearchStrategy[]
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
  /** Key of the string property that names instances; null when the lens hides it. */
  nameProperty: string | null
  /** The ordered keys of the identity properties; null when the type has
   * no identity or the lens does not show all of them. */
  identityProperties: string[] | null
  properties: SchemaProperty[]
}

export interface SchemaRelationType {
  key: string
  displayName: string
  description: string | null
  fromEntityTypeKey: string
  toEntityTypeKey: string
  /** The parent end; null for an ordinary relation type. */
  parent: ParentEnd | null
  /** One per pair; absent when off. A parent relation always has it. */
  onePerPair?: boolean
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

export interface Agent {
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
  /** The readable identity; absent when the type has none (or the lens hides it). */
  _identity?: string
  [property: string]: JsonValue | undefined
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

/** One step of an entity's path (root first); `name` is null when the lens hides it. */
export interface PathStep {
  type: string
  id: string
  name: string | null
}

/* ----------------------------- runtime — rulesets ---------------------------- */

/** A ruleset's write access: what its connection may change, from read only to everything. */
export type WriteAccess = 'none' | 'propose' | 'full'

/** A set anchor's state: `found` while its entity exists, `deleted` once it is gone. */
export type AnchorState = 'found' | 'deleted'

/** A ruleset of the ontology, from the lensless list (no name, no path). */
export interface Ruleset {
  key: string
  /** Where the connection may write; null: no anchor, no limit on where. */
  anchor: { type: string; id: string; state: AnchorState } | null
  writeAccess: WriteAccess
}

/** A PUT body: an absent rule keeps its stored value; `{}` creates an empty ruleset. */
export interface RulesetPatch {
  anchor?: { type: string; id: string } | null
  writeAccess?: WriteAccess
}

/**
 * A ruleset seen through one lens (its mount's root). A hidden or deleted
 * anchor has type, id and name null and an empty path; `visible` is false
 * when the lens hides the anchor's entity.
 */
export interface RulesetView {
  key: string
  writeAccess: WriteAccess
  anchor: {
    type: string | null
    id: string | null
    name: string | null
    state: AnchorState
    visible: boolean
    /** Root → … → the anchor's entity, through the lens. */
    path: PathStep[]
  } | null
}

/* ---------------------------- runtime — changesets --------------------------- */

/** `draft`: open to change; `submitted`: frozen and handed over for review. */
export type ChangesetState = 'draft' | 'submitted'

/** A changeset as every answer shows it. */
export interface Changeset {
  id: string
  /** What people call it by, within its lens; never looked up. */
  number: number
  state: ChangesetState
  /** Bumped by every change; a commit names the one it looked at. */
  version: number
  note: string | null
  /** The ruleset of the URL that started it; null on the plain lens. */
  ruleset: string | null
  /** How many staged objects it holds. */
  objectCount: number
  createdAt: string
  lastChangeAt: string
  submittedAt: string | null
}

/** A changeset in the lens's list: its staged objects per operation, and the types they name. */
export interface ChangesetListItem extends Changeset {
  /** Keyed `<action>_<kind>`, such as `create_entity`. */
  operations: Record<string, number>
  /** The type keys the lens shows, sorted. */
  types: string[]
  /** How many type keys the staged objects name that the lens no longer shows. */
  notVisible: number
}

/** One end of a staged relation. */
export interface ChangesetEnd {
  id: string
  /** Null when the lens shows no name for it. */
  name: string | null
}

/** A fault the lock-free pass finds on a staged object or value: drift, dangling, not_visible, missing, replay. */
export interface ChangesetMarker {
  kind: string
  message: string
}

export type StagedKind = 'entity' | 'relation'
export type StagedAction = 'create' | 'update' | 'delete'

/**
 * One staged value of an object. Document values, in `before`, `current`
 * and `after`, are stubs `{document: true, length}`.
 */
export interface StagedValueView {
  property: string
  /** An update's stored value at the key's first touch (or its last
   * rebase); null for a key the target lacked, and on a create. */
  before: JsonValue
  /** An update's stored value now; null when the target is gone or lacks
   * the key, and on a create. Drift is `current` ≠ `before`. */
  current: JsonValue
  /** The staged value; null removes the property. */
  after: JsonValue
  /** Drift or replay on this value. */
  markers: ChangesetMarker[]
}

/**
 * One staged object — an entity or relation the changeset touches — as the
 * review read shows it through the lens. An object whose type the lens no
 * longer shows has `type` null and no values.
 */
export interface StagedObjectView {
  id: string
  kind: StagedKind
  type: string | null
  action: StagedAction
  firstTouchedAt: string
  /** Entities: the name. */
  name?: string | null
  /** Entities whose identity the changeset sets or changes: the stored
   * identity (null on a create) and the one after. */
  identity?: { before: string | null; after: string }
  /** Relations: the two ends. */
  from?: ChangesetEnd
  to?: ChangesetEnd
  /** Faults on the object as a whole: not visible, missing, dangling, a value it lacks. */
  markers: ChangesetMarker[]
  /** Its staged values the lens shows; none on a delete. */
  values: StagedValueView[]
}

/** The review read: the changeset and one page of its staged objects by first touch. */
export interface ChangesetDetail extends Changeset {
  offset: number
  limit: number
  objects: StagedObjectView[]
}

/**
 * One entity as a commit of a changeset would leave it: the stored entity,
 * or the one the changeset creates, with its staged values applied (no
 * defaults yet, documents as stubs), and beside it its staged object as the
 * review read shows it.
 */
export interface StagedEntity {
  /** A staged create has no `_createdAt` / `_updatedAt`. */
  entity: { _id: string; _entityTypeKey: string; [property: string]: JsonValue }
  /** The changeset deletes it. */
  deleted: boolean
  /** Null when nothing is staged on it. */
  object: StagedObjectView | null
}

/** One reason a commit was rejected: on a staged object and maybe one of its
 * properties, or on the changeset as a whole (`object` null). */
export interface ChangesetViolation {
  object: string | null
  property?: string
  kind: string
  message: string
}

/** A commit's answer: the staged objects applied, and the ids of the deletes that found nothing. */
export interface CommitResult {
  committed: number
  alreadyGone: string[]
}

/** A check that passed: what a commit of the version checked would answer. */
export interface CheckResult extends CommitResult {
  version: number
}

/** The parent relation a create names for its new entity. */
export interface ParentRelationInput {
  type: string
  parentId: string
  properties?: Record<string, JsonValue>
}

/**
 * One write staged into a changeset, as the immediate write would make it;
 * values go under `properties`, unlike the immediate routes' flat bodies.
 */
export type StageWritePayload =
  | {
      operation: 'create_entity'
      type: string
      properties: Record<string, JsonValue>
      parentRelation?: ParentRelationInput
    }
  | { operation: 'update_entity'; type: string; id: string; properties: Record<string, JsonValue | null> }
  | { operation: 'delete_entity'; type: string; id: string }
  | {
      operation: 'create_relation'
      type: string
      fromEntityId: string
      toEntityId: string
      properties: Record<string, JsonValue>
    }
  | { operation: 'delete_relation'; type: string; id: string }

/** A staged call's answer: the id of its object; a create with a parent
 * relation also names the relation's, an entity delete the staged relations
 * at it that it removed. */
export interface StagedAnswer {
  id: string
  relation?: { id: string }
  cascaded?: string[]
}

/* ------------------------------ runtime — search ----------------------------- */

export type SearchStrategy = 'semantic' | 'keyword' | 'keyword-any' | 'keyword-all' | 'hybrid'
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
  /** The entry the hit was found by. */
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
  target: { id: string; type: string; label: string | null; identity: string | null } | null
  /** At most 200 characters of the matched entry text. */
  snippet: string
  /** Passages only. */
  charOffset: number | null
  charLength: number | null
}
/** The body `POST /search/entities` takes; `POST /search/passages` adds to it. */
export interface EntitySearchBody {
  query: string
  /** One scope field at a time; none searches every type the lens shows. */
  types?: string[]
  indices?: string[]
  keyword?: { match?: 'any' | 'all' }
  semantic?: { minSimilarity?: number }
  /** The entity list's `filter.*` keys without the prefix. */
  filter?: Record<string, string>
  limit?: number
}

export interface PassageSearchBody extends EntitySearchBody {
  /** Document properties as `type.property`. */
  documents?: string[]
  perEntity?: number
  text?: boolean
}

/** What could not run, or what a named scope could not serve. */
export interface SearchLimitation {
  code: 'not-searchable' | 'switched-off' | 'not-ready' | 'filter-excludes-all-types'
  message: string
  method?: Representation
  indices?: string[]
  types?: string[]
  /** Named document properties, as `type.property`. */
  documents?: string[]
}

/** An entity as a search names it; `name` is null when it has none or the lens hides it. */
export interface EntityReference {
  _id: string
  _entityTypeKey: string
  name: string | null
  /** Its identity properties and their values, in the identity's order; absent when its
   * type declares none the lens shows. Never on a relation target. */
  identity?: Record<string, JsonValue>
}

/** The best entry that found an entity. */
export interface EntityMatch {
  index: string
  part: 'self' | 'relation' | 'passage'
  /** Null when the index reads a property the lens hides. */
  snippet: string | null
  /** Passages: the document, null when the lens hides it. */
  property?: string | null
  charOffset?: number
  charLength?: number
  /** Relations: the relation type and the entity at its other end. */
  relationType?: string
  target?: EntityReference
}

export interface EntitySearchItem {
  rank: number
  entity: EntityReference
  match: EntityMatch
}

export interface EntitySearchResponse {
  ran: Representation[]
  items: EntitySearchItem[]
  limitations: SearchLimitation[]
}

export interface PassageSearchItem {
  rank: number
  entity: EntityReference
  passage: {
    property: string
    ordinal: number
    charOffset: number
    charLength: number
    /** Absent when the request sent `text: false`. */
    text?: string
  }
}

export interface PassageSearchResponse {
  ran: Representation[]
  items: PassageSearchItem[]
  limitations: SearchLimitation[]
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

/** An assistant kind, as it appears in `/ai/assistants/<kind>`. */
export type AssistantKind = 'agents' | 'retrievers' | 'navigators'

/** One entry of a kind's runtime list; the built-in default (`_default`) comes first. */
export interface RuntimeAssistant {
  key: string
  name: string
  description: string | null
  builtIn: boolean
}

/** One message of a thread read back: user messages and the assistant's answers, no tool payloads. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantThread {
  threadId: string
  messages: ChatMessage[]
}

export interface ToolCall {
  callId: string
  tool: string
  args: Record<string, unknown>
  result?: unknown
  status: 'pending' | 'completed' | 'interrupted'
  /** Client clock (ms) when the call and its result arrived; the stream carries no timing. */
  startedAt?: number
  finishedAt?: number
}

/* ------------------------------ authentication ------------------------------ */

export type Role = 'platform_admin' | 'ontology_creator' | 'ontology_admin' | 'reader' | 'proposer' | 'writer'

/** A person signing in through the browser, or a service calling with a token. */
export interface User {
  id: string
  kind: 'user' | 'service'
  displayName: string
  email: string | null
  username: string | null
  status: 'active' | 'disabled'
  createdAt: string
  lastLoginAt: string | null
}

/** One role of one principal: platform roles carry no keys, `ontology_admin` an ontology, the lens roles a lens. */
export interface Assignment {
  id: string
  role: Role
  ontologyKey: string | null
  lensKey: string | null
  ontologyId: string | null
  lensId: string | null
  createdAt: string
}

/** `GET /api/auth/me` — the mode, and with authentication on the signed-in user (or null). */
export type AuthMe =
  | { authentication: false }
  | { authentication: true; user: User | null; assignments: Assignment[] }

export interface UserDetail extends User {
  assignments: Assignment[]
}

export interface AssignmentInput {
  role: Role
  ontologyKey?: string
  lensKey?: string
}

/** One assignment within an ontology, with its holder (`GET /api/ontologies/:o/access`). */
export interface AccessAssignment extends Assignment {
  user: User
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
  /** The ordered keys of the identity properties; null when it has none. */
  identityProperties: string[] | null
  createdAt: string
  updatedAt: string
}

/** The end of a parent relation that holds the parent. */
export type ParentEnd = 'source' | 'target'

export interface RelationType {
  relationTypeId: string
  key: string
  displayName: string
  description: string | null
  sourceEntityTypeKey: string
  targetEntityTypeKey: string
  /** The parent end; null for an ordinary relation type. */
  parent: ParentEnd | null
  /** At most one relation of the type from one source entity to one target entity; always true with a parent end. */
  onePerPair: boolean
  createdAt: string
  updatedAt: string
}

/** A relation rule the stored data can break: the parent rules, and one per pair. */
export type RelationRule = 'two_parents' | 'cycle' | 'duplicate_pair'

/** One broken relation rule in a refused rules write (409 `details.violations`). */
export interface RelationRuleViolation {
  rule: RelationRule
  /** Every entity that breaks the rule; for `duplicate_pair`, every pair linked twice. */
  count: number
  /** The first five of them; for `duplicate_pair`, each pair's source. */
  entities: { type: string; id: string }[]
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
  /** Progress of the build filling a new generation; `null` when none is. */
  build: { done: number; total: number } | null
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

/**
 * One kind of entry an index holds per entity, composed from the schema:
 * `⟦root.x⟧`, `⟦relation.x⟧`, `⟦target.x⟧` and `⟦passage⟧` stand in for
 * the values.
 */
export interface OutlinePart {
  partKind: 'self' | 'relation' | 'passage'
  /** The relation group's position; null for self and passages. */
  groupNo: number | null
  relationType: string | null
  direction: RelationDirection | null
  targetType: string | null
  keywordText: string
  semanticText: string
  /** `fallback`: every clause of the template dropped — labelled lines stand. */
  template: 'none' | 'rendered' | 'fallback'
  /** Template placeholders, as written in the braces, that never have a value. */
  unresolved: string[]
}

export interface SearchIndexPreview {
  valid: boolean
  issues: ValidationError[]
  /** Null when the draft is invalid. */
  estimate: CostEstimate | null
  /** Null when the parts it reads — all but key, name and description — are not well-shaped. */
  outline: OutlinePart[] | null
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

/** Sparse update: an omitted field stays unchanged. A description can be replaced, not cleared. */
export interface EntityTypeUpdate {
  displayName?: string
  description?: string
  /** Reassign to another string property of the type. */
  nameProperty?: string
  /** Set (1 to 5 ordered keys of string, integer or date properties) or, with null, clear the identity. */
  identityProperties?: string[] | null
}

/** Sparse update: an omitted field stays unchanged. */
export interface RelationTypeUpdate {
  displayName?: string
  description?: string
  /** Set or flip the parent end; null clears it. */
  parent?: ParentEnd | null
  /** Turn one per pair on or off; refused off while a parent end is set. */
  onePerPair?: boolean
}

/** Create body of a property. The server stores defaults as strings. */
export interface PropertyInput {
  key?: string
  displayName: string
  description?: string | null
  dataType?: DataType
  required?: boolean
  defaultValue?: string | null
}

/**
 * Sparse update: an omitted field stays unchanged. A description can be
 * replaced, not cleared; `defaultValue: null` clears the default.
 */
export interface PropertyUpdate {
  displayName?: string
  description?: string
  required?: boolean
  defaultValue?: string | null
}

export interface AgentInput {
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
