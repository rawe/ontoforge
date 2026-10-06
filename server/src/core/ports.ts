/**
 * Persistence port: store interfaces, store accessors, adapter lifecycle.
 *
 * Services, routers, and MCP handlers obtain their store through this
 * module and speak schema vocabulary only (type keys, property keys,
 * instance ids, structured filters). Everything database-specific —
 * connections, transactions, query text, physical naming, index DDL,
 * driver types — is owned by the adapter selected via
 * `settings.DB_BACKEND`.
 *
 * Stores are BOUND: `getModelingStore(ontologyKey)` /
 * `getRuntimeStore(ontologyKey)` return stores bound to exactly one
 * ontology; every method resolves keys within that binding, and binding
 * an unknown key fails with not-found. Registry operations live on the
 * separate `OntologyRegistry` port. "One request, one ontology" is
 * structural above the adapter and physical inside it.
 *
 * Port contract (every adapter must satisfy it):
 *
 * 1. Methods accept and return plain JSON-safe values; temporal values
 *    cross the boundary as JS `Date` objects or ISO strings, never as
 *    driver types. The sole exception is the validated-query object from
 *    `core/oql`, which crosses the port opaque and is compiled by the
 *    adapter.
 * 2. Each method owns its connection.
 * 3. Filtering, search, and sorting inputs are structured values, never
 *    query fragments.
 * 4. Driver exceptions never cross the port; adapters raise the domain
 *    exceptions from `core/exceptions`. Expected conditions are pre-checked
 *    by the services or expressed as `null` returns; anything left — lost
 *    connections, timeouts, index state, constraint violations the code did
 *    not anticipate — is raised as `StoreError`, whose message carries no
 *    storage detail. The adapter logs what it withheld against the error's
 *    `errorId`, which is what reaches the client.
 * 5. Adapters declare the type keys they cannot store — keys whose physical
 *    form would collide with the adapter's own storage objects — through
 *    `reservedEntityTypeKeys()` and `reservedRelationTypeKeys()` on the
 *    modeling store. They return plain type keys, never physical names, so
 *    the modeling service can reject a colliding key without knowing why it
 *    collides. An adapter with no such collisions returns empty sets.
 * 6. Adapters declare whether their search evaluates relation
 *    conditions — path conditions and relation existence — through
 *    `supportsSearchPathConditions()` on the runtime store, and the
 *    runtime service enforces the declaration: on an adapter declaring
 *    none, a query path or a relation existence test on search is
 *    rejected above the port, naming the entity list as the alternative.
 *
 * The `ModelingStore` and `RuntimeStore` interfaces below, together with
 * the conformance suite, are the authoritative contract — adapters are
 * peers under it; none is the reference implementation. An adapter
 * implements both interfaces (the Neo4j adapter does so in
 * `adapters/neo4j/modelingStore.ts` and `adapters/neo4j/runtimeStore.ts`)
 * and its package is registered as one thunk line in `ADAPTERS`.
 */

import type { KeywordLanguageSet } from "./keywordLanguage.js";
import type { RetrieverAgentRecord, RetrieverAgentWrite } from "./retrieverAgent.js";

import { settings } from "../config.js";
import { NotFoundError } from "./exceptions.js";
import type { ValidatedQuery } from "./oql/index.js";
import type { NewPropertyDef, PropertyDef, TypeKind } from "./schemas.js";
import type {
  SearchIndexDefinition,
  SearchIndexKind,
  SearchRepresentation,
} from "./searchIndex.js";
import type { IndexContentSize } from "./searchPipeline.js";

/** A raw store row: one entity, relation, or schema object as a plain map. */
export type Row = Record<string, unknown>;

/** The closed comparison-operator vocabulary; a bare filter key means
 * `eq`. `ne` holds only where the property exists and differs — a missing
 * value never matches, as under every other comparison. */
export type FilterOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains";

/**
 * One parsed filter condition, tagged by `kind`. Built by the runtime
 * service — which validates the key, coerces the value, and checks the
 * operator above the port — so adapters receive only valid input,
 * dispatch on the kind, and do pure predicate assembly. Two families:
 * the comparison conditions carry an operator and a value already
 * coerced to the final property's declared data type (`contains`
 * compares textually and carries the string form); the existence
 * conditions carry no value, only whether the subject must be present.
 * In each family the plain condition names one property of the listed
 * type and the path condition crosses one relation type to a property
 * of the related entity or of the relation itself; the relation
 * existence condition names a relation type alone.
 */
export interface PropertyFilterCondition {
  kind: "property";
  propertyKey: string;
  dataType: string;
  op: FilterOperator;
  value: unknown;
}

/**
 * A query path, fully resolved above the port: the relation type crossed,
 * the direction to cross it in — always explicit here, derived by the
 * service from the relation type's endpoints or taken from the key's
 * direction marker — where the final property
 * lives (on the related entity, or on the relation itself), and the
 * property itself. An entity matches when at least one relation of the
 * type reachable through the path carries, or reaches a related entity
 * that carries, a value satisfying the comparison.
 */
export interface PathFilterCondition {
  kind: "path";
  relationTypeKey: string;
  direction: "outgoing" | "incoming";
  propertySource: "relatedEntity" | "relation";
  propertyKey: string;
  dataType: string;
  op: FilterOperator;
  value: unknown;
}

/** Whether one property of the listed type is present (`exists: true`)
 * or absent (`exists: false`). A property set to null is absent — the
 * service never stores a null — so presence is the key being stored. */
export interface PropertyExistenceCondition {
  kind: "property-existence";
  propertyKey: string;
  exists: boolean;
}

/** The existence test on a query path: the path is resolved exactly as
 * a comparison path, and the entity matches when at least one relation
 * of the type reaches a value — on the related entity or on the relation
 * itself — that is present (`exists: true`) or absent (`exists: false`). */
export interface PathExistenceCondition {
  kind: "path-existence";
  relationTypeKey: string;
  direction: "outgoing" | "incoming";
  propertySource: "relatedEntity" | "relation";
  propertyKey: string;
  exists: boolean;
}

/** Whether the listed entity has at least one relation of the type in
 * the resolved direction (`exists: true`) or none at all (`exists:
 * false`) — the latter an anti-existence predicate, `NOT EXISTS` over
 * the relations of the type, never a value comparison. The direction is
 * settled above the port exactly as for a query path. */
export interface RelationExistenceCondition {
  kind: "relation-existence";
  relationTypeKey: string;
  direction: "outgoing" | "incoming";
  exists: boolean;
}

export type FilterCondition =
  | PropertyFilterCondition
  | PathFilterCondition
  | PropertyExistenceCondition
  | PathExistenceCondition
  | RelationExistenceCondition;

/** One stored type whose key the active adapter now reserves. */
export interface ReservedTypeKeyInUse {
  kind: TypeKind;
  key: string;
}

/**
 * The modeling side of the persistence port: schema persistence.
 *
 * Capability grouping follows `docs/storage-adapters.md` ("The two store
 * surfaces"); the section comments below mirror it. The optional methods
 * marked "own search storage" are present exactly when the adapter stores
 * no search indices (`core/ownSearch.ts`).
 */
export interface ModelingStore {
  /** The search-index store of the same ontology. Present exactly when the
   * adapter stores search indices (`supportsSearchIndices()`): the
   * modeling service keeps the managed indices in step with the schema
   * through it. */
  searchIndices?(): SearchIndexStore;

  // ------------------------------------------------------------------
  // Reserved keys
  // ------------------------------------------------------------------

  /** Entity type keys this adapter cannot store (contract rule 5). */
  reservedEntityTypeKeys(): ReadonlySet<string>;

  /** Relation type keys this adapter cannot store (contract rule 5). */
  reservedRelationTypeKeys(): ReadonlySet<string>;

  /** Stored types with a now-reserved key, as `{kind, key}` rows. */
  findReservedTypeKeysInUse(): Promise<ReservedTypeKeyInUse[]>;

  // ------------------------------------------------------------------
  // Lenses
  // ------------------------------------------------------------------

  createLens(
    lensId: string,
    key: string,
    name: string,
    description: string | null,
  ): Promise<Row>;

  listLenses(): Promise<Row[]>;

  getLens(lensId: string): Promise<Row | null>;

  getLensByName(name: string): Promise<Row | null>;

  getLensByKey(key: string): Promise<Row | null>;

  updateLens(
    lensId: string,
    name: string | null,
    description: string | null,
  ): Promise<Row | null>;

  deleteLens(lensId: string): Promise<boolean>;

  // ------------------------------------------------------------------
  // Entity types
  // ------------------------------------------------------------------

  /** Create the type together with its name property, in one operation:
   * an entity type never exists without its name property. Entity type
   * rows carry `nameProperty`, the name property's key. */
  createEntityType(
    entityTypeId: string,
    key: string,
    displayName: string,
    description: string | null,
    nameProperty: NewPropertyDef,
  ): Promise<Row>;

  listEntityTypes(): Promise<Row[]>;

  getEntityType(entityTypeId: string): Promise<Row | null>;

  getEntityTypeByKey(key: string): Promise<Row | null>;

  /** `nameProperty` names an existing `string` property of the type
   * (checked by the service); null leaves it unchanged. */
  updateEntityType(
    entityTypeId: string,
    displayName: string | null,
    description: string | null,
    nameProperty: string | null,
  ): Promise<Row | null>;

  deleteEntityType(entityTypeId: string): Promise<boolean>;

  isEntityTypeReferenced(entityTypeId: string): Promise<boolean>;

  // ------------------------------------------------------------------
  // Relation types
  // ------------------------------------------------------------------

  createRelationType(
    relationTypeId: string,
    key: string,
    displayName: string,
    description: string | null,
    sourceEntityTypeKey: string,
    targetEntityTypeKey: string,
  ): Promise<Row>;

  listRelationTypes(): Promise<Row[]>;

  getRelationType(relationTypeId: string): Promise<Row | null>;

  getRelationTypeByKey(key: string): Promise<Row | null>;

  updateRelationType(
    relationTypeId: string,
    displayName: string | null,
    description: string | null,
  ): Promise<Row | null>;

  deleteRelationType(relationTypeId: string): Promise<boolean>;

  // ------------------------------------------------------------------
  // Property definitions
  // ------------------------------------------------------------------

  createProperty(
    ownerId: string,
    typeKind: TypeKind,
    propertyId: string,
    key: string,
    displayName: string,
    description: string | null,
    dataType: string,
    required: boolean,
    defaultValue: string | null,
  ): Promise<Row>;

  listProperties(ownerId: string, typeKind: TypeKind): Promise<Row[]>;

  getProperty(ownerId: string, typeKind: TypeKind, propertyId: string): Promise<Row | null>;

  getPropertyByKey(ownerId: string, typeKind: TypeKind, key: string): Promise<Row | null>;

  updateProperty(
    ownerId: string,
    typeKind: TypeKind,
    propertyId: string,
    displayName: string | null,
    description: string | null,
    required: boolean | null,
    defaultValue: string | null,
    clearDefault: boolean,
  ): Promise<Row | null>;

  deleteProperty(ownerId: string, typeKind: TypeKind, propertyId: string): Promise<boolean>;

  // ------------------------------------------------------------------
  // Scope inclusions (lifecycle)
  // ------------------------------------------------------------------

  addIncludesType(
    lensId: string,
    typeKind: TypeKind,
    typeKey: string,
    properties: string[] | null,
  ): Promise<Row | null>;

  listIncludesTypes(lensId: string, typeKind: TypeKind): Promise<Row[]>;

  updateIncludesType(
    lensId: string,
    typeKind: TypeKind,
    typeId: string,
    properties: string[] | null,
  ): Promise<Row | null>;

  removeIncludesType(lensId: string, typeKind: TypeKind, typeId: string): Promise<boolean>;

  // ------------------------------------------------------------------
  // Scope inclusions (cascade-protocol support)
  // ------------------------------------------------------------------

  removeAllIncludesForType(typeKind: TypeKind, typeId: string): Promise<number>;

  findLensesIncludingType(typeKind: TypeKind, typeId: string): Promise<string[]>;

  findLensesWithExplicitProperty(
    typeKind: TypeKind,
    typeId: string,
    propertyKey: string,
  ): Promise<string[]>;

  addPropertyToIncludesLists(
    typeKind: TypeKind,
    typeId: string,
    propertyKey: string,
  ): Promise<number>;

  removePropertyFromIncludesLists(
    typeKind: TypeKind,
    typeId: string,
    propertyKey: string,
  ): Promise<number>;

  // ------------------------------------------------------------------
  // Document-property cleanup (own search storage)
  // ------------------------------------------------------------------

  /** Delete every chunk of one (entity type, document property) pair.
   * Invoked when the property, or its owning type, is removed. */
  deleteChunksForTypeProperty?(entityTypeKey: string, propertyKey: string): Promise<void>;

  // ------------------------------------------------------------------
  // Full schema (get_schema now; validation and export later)
  // ------------------------------------------------------------------

  getFullSchema(): Promise<Row>;

  // ------------------------------------------------------------------
  // AI agent configs
  // ------------------------------------------------------------------

  listAiAgents(lensId: string): Promise<Row[]>;

  upsertAiAgent(
    lensId: string,
    agentConfigId: string,
    key: string,
    name: string,
    description: string | null,
    systemPrompt: string | null,
    tools: string[] | null,
  ): Promise<[Row, boolean]>;

  listAiAgentsForExport(lensId: string): Promise<Row[]>;

  deleteAiAgent(lensId: string, agentKey: string): Promise<boolean>;

  // ------------------------------------------------------------------
  // Saved query configs
  // ------------------------------------------------------------------

  listSavedQueries(lensId: string): Promise<Row[]>;

  listSavedQueriesForExport(lensId: string): Promise<Row[]>;

  upsertSavedQuery(
    lensId: string,
    savedQueryId: string,
    key: string,
    name: string,
    description: string,
    stepsJson: string,
    parametersJson: string,
    lensKey?: string | null,
    embedding?: number[] | null,
  ): Promise<[Row, boolean]>;

  deleteSavedQuery(lensId: string, queryKey: string): Promise<boolean>;

  /** Ensure the saved-query description index at `dimensions`; a drifted
   * width is reported, never repaired. */
  ensureSavedQueryVectorIndex(dimensions: number): Promise<void>;

  // ------------------------------------------------------------------
  // Embedding maintenance (rebuild support)
  // ------------------------------------------------------------------

  listSavedQueryRefs(): Promise<Row[]>;

  setSavedQueryEmbedding(savedQueryId: string, embedding: number[]): Promise<void>;

  /** Own search storage. */
  getEntityTypesWithProperties?(): Promise<Row[]>;

  /** Own search storage: store one entity's semantic vector (null: none). */
  setEntityEmbedding?(entityId: string, embedding: number[] | null): Promise<void>;

  // ------------------------------------------------------------------
  // Vector-index DDL (own search storage)
  // ------------------------------------------------------------------

  createVectorIndex?(
    entityTypeKey: string,
    dimensions: number,
    filterProperties?: string[] | null,
  ): Promise<void>;

  dropVectorIndex?(entityTypeKey: string): Promise<void>;

  rebuildVectorIndex?(entityTypeKey: string, dimensions: number): Promise<void>;

  createDocumentVectorIndex?(
    entityTypeKey: string,
    propertyKey: string,
    dimensions: number,
  ): Promise<void>;

  dropDocumentVectorIndex?(entityTypeKey: string, propertyKey: string): Promise<void>;

  /**
   * Drop every semantic index whose width no longer matches the model —
   * on an adapter that stores search indices, the saved-query index alone
   * (search-index generations record their own model and width).
   *
   * The rebuild's first phase, and the only place drift is repaired
   * rather than reported. It has to come first: an index fixes its width
   * when it is created, so while a drifted one stands, storing a vector
   * of the model's width fails — there is no order in which the vectors
   * could be regenerated underneath it. What this leaves absent,
   * `ensureVectorIndexes` builds again once the new vectors are in place.
   */
  dropMismatchedVectorIndexes(dimensions: number): Promise<void>;

  /**
   * Build every semantic index the schema calls for and does not have,
   * at `dimensions` — as above, the saved-query index alone where search
   * indices are stored. An index whose width has drifted is REPORTED and
   * left alone — repair belongs to the rebuild, through the method above.
   */
  ensureVectorIndexes(dimensions: number): Promise<void>;
}

/**
 * The runtime side of the persistence port: instance-data persistence.
 *
 * Capability grouping follows `docs/storage-adapters.md` ("The two store
 * surfaces"); the section comments below mirror it.
 *
 * Filter-taking methods (`listEntities`, `listRelations`, and the two
 * property and document rankings) receive
 * parsed, coerced `FilterCondition`s built by the service — filter
 * validation happens above the port, so adapters receive only valid
 * input and raise no validation errors. A path or relation existence
 * condition reaches a search only where the adapter declares support
 * (contract rule 6). Three reads carry the property definitions for row
 * decoding — `getEntityById`, `getEntitiesByIds`, and `getNeighbors` (an
 * adapter whose storage is self-describing may ignore them); listing
 * paths carry them for the same reason. `getEntity` and `getRelation`
 * carry none. The optional methods marked "own search storage" are
 * present exactly when the adapter stores no search indices
 * (`core/ownSearch.ts`).
 */
export interface SearchedType {
  entityTypeKey: string;
  propertyDefs: Record<string, PropertyDef>;
  conditions: FilterCondition[];
}
export interface SearchedProperty {
  entityTypeKey: string;
  propertyKey: string;
  conditions: FilterCondition[];
}

/** The keyword retrieval method: any admits a row carrying any query term, all
 * requires every query term; both match each term as a prefix. Contract:
 * `docs/storage-adapters.md`, "The search-index store" (ranking entries). */
export type KeywordMatching = "any" | "all";

export interface RuntimeStore {
  /** The ontology this store is bound to. The runtime schema cache keys
   * its entries by this binding plus the lens key. */
  readonly ontologyKey: string;

  // ------------------------------------------------------------------
  // Declarations
  // ------------------------------------------------------------------

  /** Whether this adapter's search evaluates relation conditions — path
   * conditions and relation existence — in both rankings, entities and
   * document passages (contract rule 6). Declared as a plain flag so the
   * service can reject such a filter on search without knowing why the
   * adapter cannot evaluate it. */
  supportsSearchPathConditions(): boolean;
  /** Whether search can rank by keyword — through the search indices on
   * an adapter that stores them. */
  supportsKeywordRanking(): boolean;

  // ------------------------------------------------------------------
  // Schema reading (for the runtime schema cache)
  // ------------------------------------------------------------------

  /** Unfiltered: the adapter never applies the inclusions. Null when no
   * lens has the key. Contract: `docs/storage-adapters.md`, "Schema reading".
   * An adapter that stores search indices adds `searchIndexInclusions`,
   * the keys of the indices the lens includes. */
  getFullSchemaWithLensInclusions(lensKey: string): Promise<Row | null>;

  getAiAgentConfigs(lensKey: string): Promise<Row[]>;

  getSavedQueries(lensKey: string): Promise<Row[]>;

  // ------------------------------------------------------------------
  // Vector-index metadata validation (own search storage)
  // ------------------------------------------------------------------

  /** Reject property values the adapter's vector-index filter metadata
   * cannot hold. Synchronous; raises the domain `ValidationError`. An
   * adapter without such limits implements it as a no-op. */
  validateVectorIndexedProperties?(
    entityTypeKey: string,
    properties: Row,
    filterProperties: string[],
    entityId?: string | null,
  ): void;

  // ------------------------------------------------------------------
  // Search indices
  // ------------------------------------------------------------------

  /** The search-index store of the same ontology. Present exactly when the
   * adapter stores search indices (`supportsSearchIndices()`). */
  searchIndices?(): SearchIndexStore;

  // ------------------------------------------------------------------
  // Entity instances
  //
  // Each write takes an optional `search` plan: the search work the write
  // causes (`core/searchDependencies.ts`). An adapter that stores search
  // indices applies it in the write's own transaction, so the work is
  // queued exactly when the write commits; one that does not ignores it.
  // The `embedding` is the entity's semantic vector on an adapter with
  // its own search storage; an adapter that stores search indices never
  // receives one and ignores it.
  // ------------------------------------------------------------------

  createEntity(
    entityTypeKey: string,
    entityId: string,
    properties: Row,
    propertyDefs: Record<string, PropertyDef>,
    embedding?: number[] | null,
    search?: SearchWritePlan | null,
  ): Promise<Row>;

  listEntities(
    entityTypeKey: string,
    propertyDefs: Record<string, PropertyDef>,
    filters: FilterCondition[],
    search: string | null,
    searchPropertyKeys: string[],
    sortField: string,
    order: string,
    limit: number,
    offset: number,
  ): Promise<[Row[], number]>;

  getEntity(entityTypeKey: string, entityId: string): Promise<Row | null>;

  getEntityById(
    entityId: string,
    propertyDefs: Record<string, PropertyDef>,
  ): Promise<Row | null>;

  updateEntity(
    entityTypeKey: string,
    entityId: string,
    setProperties: Row,
    removeProperties: string[],
    propertyDefs: Record<string, PropertyDef>,
    embedding?: number[] | null,
    hasEmbeddingUpdate?: boolean,
    search?: SearchWritePlan | null,
  ): Promise<Row | null>;

  deleteEntity(
    entityTypeKey: string,
    entityId: string,
    search?: SearchWritePlan | null,
  ): Promise<boolean>;

  getEntitiesByIds(
    entityIds: string[],
    propertyDefs: Record<string, PropertyDef>,
  ): Promise<Record<string, Row>>;

  // ------------------------------------------------------------------
  // Document chunks (own search storage)
  // ------------------------------------------------------------------

  getChunkEmbeddingsForEntityProperty?(
    entityId: string,
    propertyKey: string,
  ): Promise<Record<string, number[]>>;

  deleteChunksForEntityProperty?(entityId: string, propertyKey: string): Promise<void>;

  createDocumentChunks?(
    entityId: string,
    entityTypeKey: string,
    propertyKey: string,
    chunks: Row[],
  ): Promise<void>;

  // ------------------------------------------------------------------
  // Semantic search
  // ------------------------------------------------------------------

  /** Own search storage. Semantic score is the original (1 + cosine) / 2
   * similarity, not confidence. */
  propertySearchSemantic?(searchedTypes: SearchedType[], queryEmbedding: number[], limit: number): Promise<Row[]>;
  documentSearchSemantic?(searchedProperties: SearchedProperty[], queryEmbedding: number[], limit: number): Promise<Row[]>;

  /** Rank SavedQuery descriptions for one lens by vector similarity. */
  searchSavedQueries(
    queryEmbedding: number[],
    lensKey: string,
    limit: number,
    minScore: number | null,
  ): Promise<Row[]>;

  // ------------------------------------------------------------------
  // Relation instances (`search` as for entity writes)
  // ------------------------------------------------------------------

  createRelation(
    relationTypeKey: string,
    relationId: string,
    fromEntityId: string,
    toEntityId: string,
    properties: Row,
    propertyDefs: Record<string, PropertyDef>,
    search?: SearchWritePlan | null,
  ): Promise<Row>;

  listRelations(
    relationTypeKey: string,
    propertyDefs: Record<string, PropertyDef>,
    filters: FilterCondition[],
    fromEntityId: string | null,
    toEntityId: string | null,
    sortField: string,
    order: string,
    limit: number,
    offset: number,
  ): Promise<[Row[], number]>;

  getRelation(relationTypeKey: string, relationId: string): Promise<Row | null>;

  updateRelation(
    relationTypeKey: string,
    relationId: string,
    setProperties: Row,
    removeProperties: string[],
    propertyDefs: Record<string, PropertyDef>,
    search?: SearchWritePlan | null,
  ): Promise<Row | null>;

  deleteRelation(
    relationTypeKey: string,
    relationId: string,
    search?: SearchWritePlan | null,
  ): Promise<boolean>;

  // ------------------------------------------------------------------
  // OQL
  // ------------------------------------------------------------------

  /**
   * Compile a validated OQL query to the adapter's native dialect and
   * execute it read-only. The validated query crosses the port opaque
   * (rule 1); parameters arrive separately as a map (empty for ad-hoc
   * queries — binding is a saved-query concern).
   */
  executeOql(validated: ValidatedQuery, params?: Row): Promise<[string[], Row[]]>;

  // ------------------------------------------------------------------
  // Graph traversal
  // ------------------------------------------------------------------

  getNeighbors(
    entityId: string,
    direction: string,
    relationTypeKey: string | null,
    limit: number,
    propertyDefsByType: Record<string, Record<string, PropertyDef>>,
  ): Promise<Row[]>;
}

// ---------------------------------------------------------------------------
// Search indices
// ---------------------------------------------------------------------------

/** What one entry holds: an entity's own fields, one relation instance,
 * or one passage of a document. */
export type SearchPartKind = "self" | "relation" | "passage";

/** A generation's lifecycle: built beside the active one, then `ready`
 * (the one queries read, at most one per index and representation);
 * `retired` once replaced or superseded, `failed` when its build failed.
 * Retired and failed generations keep their row; their entries go. */
export type SearchGenerationState = "building" | "ready" | "retired" | "failed";

/** The ontology's search settings (one per ontology). */
export interface SearchSettings {
  keywordLanguages: KeywordLanguageSet;
  /** The managed indices switched off; shape owned by the modeling service. */
  disabledDefaults: Record<string, unknown>;
}

/** One stored search index. */
export interface SearchIndexRecord {
  searchIndexId: string;
  key: string;
  kind: SearchIndexKind;
  definition: SearchIndexDefinition;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSearchGeneration {
  generationId: string;
  searchIndexId: string;
  representation: SearchRepresentation;
  definitionHash: string;
  /** Semantic only: the provider's model id and vector width. */
  modelId: string | null;
  dimensions: number | null;
  /** Keyword only: the language set the entries are stemmed in. */
  languages: KeywordLanguageSet | null;
}

export interface SearchGenerationRecord extends NewSearchGeneration {
  state: SearchGenerationState;
  total: number;
  done: number;
  failed: number;
  createdAt: Date;
  readyAt: Date | null;
}

/** The identity of one entry within a generation. `groupNo` numbers the
 * relation groups of the definition; `partId` is the relation id of a
 * relation part, the chunk ordinal of a passage. */
export interface SearchEntryPart {
  entityId: string;
  partKind: SearchPartKind;
  groupNo: number;
  partId: string;
}

export interface SearchEntryWrite extends SearchEntryPart {
  relationType: string | null;
  targetType: string | null;
  targetId: string | null;
  /** A passage's code-point offset and length in its document. */
  startChar: number | null;
  charLength: number | null;
  text: string;
  /** `entryTextHash` (`core/searchEntry.ts`), hex. */
  textHash: string;
  /** The vector of a semantic generation; null for a keyword one, whose
   * text vector the store derives from `text` in the generation's
   * languages. */
  embedding: number[] | null;
}

export interface SearchEntryHash extends SearchEntryPart {
  textHash: string;
}

/** One ranking over the entries of one generation (the query side). */
export interface SearchEntryQuery {
  generationId: string;
  /** Semantic generations: the query vector, of the generation's width. */
  vector?: number[];
  /** Keyword generations: the query text, stemmed in the generation's
   * languages, and how its terms combine. */
  text?: string;
  matching?: KeywordMatching;
  /** Exact filters on the owning entity — candidate restrictions applied
   * inside the ranking, so the limit counts entries that pass them. */
  conditions: FilterCondition[];
  /** Rank only the entries of these entities; absent or null: of every
   * entity. */
  entityIds?: readonly string[] | null;
  /** A relation entry ranks only when its relation type is listed and its
   * target type too; null lists every type. Other entries always rank. */
  relationTypes: string[] | null;
  targetTypes: string[] | null;
  limit: number;
}

/** One ranked entry. `score` is `(1 + cosine) / 2` for a semantic
 * generation and, for a keyword one, the query words the entry holds plus
 * its cover density below 1 (`keywordScore` in `core/searchQuery.ts`). */
export interface RankedSearchEntry extends SearchEntryPart {
  relationType: string | null;
  targetType: string | null;
  targetId: string | null;
  startChar: number | null;
  charLength: number | null;
  text: string;
  score: number;
}

/** What a queued item asks for: one part, or — `entity` — every part of
 * the entity (an entity created, a header field changed, a backfill).
 * `passage` with part id `""` stands for all passages: a document is
 * re-chunked whole. */
export type SearchQueuePartKind = SearchPartKind | "entity";

/** One queued piece of work: a part of an entity, in one generation. */
export interface SearchQueueItem {
  generationId: string;
  entityId: string;
  partKind: SearchQueuePartKind;
  groupNo: number;
  partId: string;
}

/** A queue item under this worker's lease. */
export interface ClaimedSearchQueueItem extends SearchQueueItem {
  representation: SearchRepresentation;
  /** Failed attempts so far. */
  attempts: number;
  /** When the item was last enqueued — opaque. A write that enqueues the
   * item again while it is leased changes it, and completing the claim
   * then leaves the item queued: the newer write is never lost. */
  token: string;
}

/** The last failed attempt of a queued item. */
export interface SearchQueueError {
  entityId: string;
  partKind: SearchQueuePartKind;
  message: string;
  at: Date;
}

/** The queue of one generation, as status reads it. */
export interface SearchQueueStats {
  generationId: string;
  /** Items still to be processed (not failed for good). */
  pending: number;
  /** Items whose attempts are used up: they wait for a rebuild or a new
   * write of their entity. */
  failed: number;
  /** The errors of failed or retrying items, newest first: the newest
   * item per distinct message, at most `MAX_LAST_ERRORS`. */
  lastErrors: SearchQueueError[];
}

/** What a full build of one custom index would read — the cost preview's
 * measurement (`SearchIndexStore.measureIndexContent`). */
export interface IndexContentRequest {
  entityType: string;
  /** Whether entities get a `self` entry (the index reads an own text field). */
  selfEntries: boolean;
  /** The document field passages are cut from, with the chunker's size
   * and overlap. */
  passages: { property: string; chunkSize: number; chunkOverlap: number } | null;
  /** Per relation group: the relation type, the end the root entity is on,
   * and the target types that count (null: any). */
  groups: { relationType: string; owner: "from" | "to"; targetTypes: string[] | null }[];
}

/**
 * The search work one entity or relation write causes, derived from the
 * ontology's index definitions (`core/searchDependencies.ts`). Index ids
 * stand for every generation of the index that is building or ready —
 * the adapter resolves them when it applies the plan.
 */
export interface SearchWritePlan {
  /** Parts of an entity to (re)compose. */
  entityParts: {
    searchIndexId: string;
    entityId: string;
    partKind: SearchQueuePartKind;
    groupNo: number;
    partId: string;
  }[];
  /** The part of one relation in one relation group, owned by the
   * relation's `from` end (outgoing group) or its `to` end (incoming). */
  relationParts: {
    searchIndexId: string;
    groupNo: number;
    relationId: string;
    owner: "from" | "to";
  }[];
  /** A target entity changed: the parts of every relation of the type that
   * has it on the non-owner end — one statement, fan-out = its degree. */
  fanOut: {
    searchIndexId: string;
    groupNo: number;
    relationType: string;
    owner: "from" | "to";
    targetEntityId: string;
  }[];
  /** An entity deleted: its entries and queued work go, and so do the
   * entries of the relations that cascade with it. */
  deleteEntity: string | null;
  /** A relation deleted: its entries and queued work go — no recompose. */
  deleteRelation: string | null;
}

/**
 * The search-index side of the persistence port: index definitions, their
 * generations and the entries a generation holds. Only adapters that
 * declare `supportsSearchIndices()` implement it.
 *
 * A generation is one build of one representation of one index. It fills
 * beside the active one, and `finishGeneration` makes it the active one in
 * a single step; the previous one then retires and its entries go. Entry
 * writes go to a generation by id wherever it is in that lifecycle, and
 * are refused (false) once it is no longer building or ready.
 */
export interface SearchIndexStore {
  /** The ontology this store is bound to. */
  readonly ontologyKey: string;

  // ------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------

  getSearchSettings(): Promise<SearchSettings>;

  setSearchSettings(settings: SearchSettings): Promise<SearchSettings>;

  // ------------------------------------------------------------------
  // Index definitions
  // ------------------------------------------------------------------

  /** Null when the definition's root entity type does not exist. A taken
   * key is a `ConflictError`. */
  createIndex(
    searchIndexId: string,
    kind: SearchIndexKind,
    definition: SearchIndexDefinition,
  ): Promise<SearchIndexRecord | null>;

  /** All indices, in key order. */
  listIndices(): Promise<SearchIndexRecord[]>;

  getIndex(key: string): Promise<SearchIndexRecord | null>;

  /** Replace the definition (the key stays). Null when the index or the
   * definition's root entity type does not exist. */
  updateIndexDefinition(
    key: string,
    definition: SearchIndexDefinition,
  ): Promise<SearchIndexRecord | null>;

  /** Delete the index with its generations, queued work, entries and lens
   * inclusions. False = not found. */
  deleteIndex(key: string): Promise<boolean>;

  /** Include an index in every scoped lens that exposes its root entity
   * type — by an entity inclusion of the type, or, with relation
   * inclusions only, every type. A passage index also needs its document
   * property exposed (no property list, or one naming it). The count of
   * lenses it was added to. */
  includeIndexInScopedLenses(key: string): Promise<number>;

  /** The keys of the indices one lens includes, sorted. Empty for an
   * unknown lens. */
  listLensIndexInclusions(lensId: string): Promise<string[]>;

  /** Include an index in one lens — no scope rule is checked here. False
   * when the lens or the index does not exist; an index the lens already
   * includes is a `ConflictError`. */
  includeIndexInLens(lensId: string, key: string): Promise<boolean>;

  /** Remove an index inclusion. False when the lens does not include it. */
  excludeIndexFromLens(lensId: string, key: string): Promise<boolean>;

  // ------------------------------------------------------------------
  // Retriever agents (lens-local; they search this store's indices)
  //
  // Keyed by lens and agent key; deleted with their lens. A transfer
  // never overwrites a target.
  // ------------------------------------------------------------------

  /** The lens's agents, by name then key. */
  listRetrieverAgents(lensId: string): Promise<RetrieverAgentRecord[]>;

  getRetrieverAgent(lensId: string, key: string): Promise<RetrieverAgentRecord | null>;

  /** Create, or replace name, description, configuration and warnings of
   * the agent with this key (its id and creation time stay). `createOnly`:
   * an existing key is a `ConflictError`. The lens missing is a
   * `NotFoundError`. True in the pair when the agent was created. */
  saveRetrieverAgent(
    lensId: string,
    agent: RetrieverAgentWrite,
    createOnly: boolean,
  ): Promise<[RetrieverAgentRecord, boolean]>;

  /** False when the lens has no agent with this key. */
  deleteRetrieverAgent(lensId: string, key: string): Promise<boolean>;

  /** Copy (`copyId`: the copy's id) or move (`copyId` null: identity kept)
   * an agent to another lens and key, atomically. The source must still
   * hold `expectedConfig` (JSON of `[configVersion, config]`) — else a
   * `ConflictError`; a taken target key is a `ConflictError`. */
  transferRetrieverAgent(
    sourceLensId: string,
    sourceKey: string,
    targetLensId: string,
    targetKey: string,
    copyId: string | null,
    expectedConfig: string,
  ): Promise<RetrieverAgentRecord>;

  // ------------------------------------------------------------------
  // Generations
  // ------------------------------------------------------------------

  /**
   * Start a building generation. A generation still building for the same
   * index and representation is superseded: it retires with its queued
   * work and entries. Null when the index does not exist.
   *
   * `backfillEntityType` queues every entity of that type (one `entity`
   * item each) in the same transaction and sets `total` to their count —
   * a generation never appears with an empty queue that is not yet filled.
   */
  createGeneration(
    generation: NewSearchGeneration,
    options?: { backfillEntityType?: string },
  ): Promise<SearchGenerationRecord | null>;

  getGeneration(generationId: string): Promise<SearchGenerationRecord | null>;

  /** All generations, or those of one index, oldest first. */
  listGenerations(searchIndexId?: string): Promise<SearchGenerationRecord[]>;

  /** Add to a generation's progress counters. */
  recordGenerationProgress(
    generationId: string,
    delta: { total?: number; done?: number; failed?: number },
  ): Promise<void>;

  /**
   * Make a building generation the active one of its index and
   * representation: build its search structures, switch, then retire the
   * previous active generation and remove its entries. False when the
   * generation is no longer building (superseded, failed or deleted).
   */
  finishGeneration(generationId: string): Promise<boolean>;

  /** Mark a building generation failed and drop its queued work and
   * entries. False when it is no longer building. */
  failGeneration(generationId: string): Promise<boolean>;

  /** Retire a building or ready generation that no definition wants any
   * more (a representation switched off, a definition changed back), with
   * its queued work and entries. False when it is neither. */
  retireGeneration(generationId: string): Promise<boolean>;

  /** Remove the entries storage of every generation that is neither
   * building nor ready — what an interrupted retirement or an entity type
   * cascade left behind. Idempotent. */
  sweepGenerations(): Promise<void>;

  // ------------------------------------------------------------------
  // Entries (the pipeline's surface)
  // ------------------------------------------------------------------

  /** Insert or replace entries of one generation by identity. False (and
   * nothing written) when the generation is no longer building or ready.
   * An identity may appear once per call. */
  upsertEntries(generationId: string, entries: SearchEntryWrite[]): Promise<boolean>;

  /** The stored text hashes of those of `parts` that exist. */
  readEntryHashes(generationId: string, parts: SearchEntryPart[]): Promise<SearchEntryHash[]>;

  /** Delete entries of one generation by identity; the count deleted. */
  deleteEntries(generationId: string, parts: SearchEntryPart[]): Promise<number>;

  /** Delete one generation's entries of one entity, part kind and group
   * whose part id is not in `keepPartIds` — the passages past a shortened
   * document, the relations that are gone. The count deleted. */
  deleteEntityPartsExcept(
    generationId: string,
    entityId: string,
    partKind: SearchPartKind,
    groupNo: number,
    keepPartIds: string[],
  ): Promise<number>;

  /** Delete an entity's entries in every generation of the ontology. */
  deleteEntriesOfEntity(entityId: string): Promise<number>;

  /** Delete a relation's entries (its `relation` parts) in every
   * generation of the ontology. */
  deleteEntriesOfRelation(relationId: string): Promise<number>;

  /** Rank the entries of one generation, best first: nearest by cosine
   * (semantic) or by keyword ranking (keyword). Empty when the generation
   * is not ready. */
  rankEntries(query: SearchEntryQuery): Promise<RankedSearchEntry[]>;

  // ------------------------------------------------------------------
  // Queue (the worker's surface)
  //
  // Writes enqueue through the runtime store's write methods (their
  // `search` plan). An item's attempts count its failures; one whose
  // attempts reached the maximum is failed for good and never claimed
  // again — a new write of its entity, or a rebuild, gives it a fresh
  // start. Every enqueue wakes the workers (after its commit).
  // ------------------------------------------------------------------

  /** Every type and property of the ontology — what the worker composes
   * entries against: `{ entityTypes, relationTypes }` as rows, the shape
   * `RuntimeStore.getFullSchemaWithLensInclusions` returns them in. */
  readFullSchema(): Promise<Row>;

  /** Queue every entity of a type, as one `entity` item each, into the
   * given generations (those no longer building or ready are skipped).
   * The count of items queued. */
  enqueueEntityType(generationIds: string[], entityTypeKey: string): Promise<number>;

  /** Lease up to `limit` claimable items — due, not leased (or the lease
   * expired), attempts below `maxAttempts`, of a building or ready
   * generation — keyword items first, then oldest first. Semantic items
   * are claimed only for generations of `semanticModelId` (none when
   * null). Items another worker holds are skipped, never waited for. */
  claimQueueItems(options: {
    limit: number;
    leaseSeconds: number;
    maxAttempts: number;
    semanticModelId: string | null;
  }): Promise<ClaimedSearchQueueItem[]>;

  /** Remove processed items — unless one was enqueued again since its
   * claim; that one stays, released for the next claim. */
  completeQueueItems(items: ClaimedSearchQueueItem[]): Promise<void>;

  /** Record a failed attempt: attempts + 1, the error, release the lease
   * and hold each item back by its delay. */
  failQueueItems(
    failures: { item: ClaimedSearchQueueItem; delayMs: number }[],
    error: string,
  ): Promise<void>;

  /** Pending and failed counts per generation that has queued items. */
  queueStats(maxAttempts: number): Promise<SearchQueueStats[]>;

  // ------------------------------------------------------------------
  // Modeling reads
  // ------------------------------------------------------------------

  /** The keys of the lenses that include an index, sorted. */
  findLensesIncludingIndex(key: string): Promise<string[]>;

  /** Count what a full build of an index would hold, from the stored
   * instances — aggregates only, no document is read into memory.
   * Passages are estimated from document lengths. */
  measureIndexContent(request: IndexContentRequest): Promise<IndexContentSize>;
}

/** A subscription to search-work wake-ups (see `subscribeSearchWork`). */
export interface SearchWorkSubscription {
  /** True once the subscription has ended — closed, or its connection
   * lost; the subscriber subscribes again. */
  readonly closed: boolean;
  close(): Promise<void>;
}

/**
 * The ontology registry: the small third port beside the two phase
 * stores. It manages ontologies as whole units — create, list, get,
 * rename, delete — while the phase stores work inside one ontology.
 *
 * Rows carry `ontologyId`, `key`, `displayName` (nullable), `createdAt`,
 * `updatedAt`. The physical isolation mechanism behind an ontology —
 * what `createOntology` provisions and `deleteOntology` cascades over —
 * is each adapter's private business; nothing above this port knows what
 * it is.
 */
export interface OntologyRegistry {
  /**
   * Create one ontology and provision its physical home atomically: a
   * failed create leaves nothing behind. `embeddingDimensions` is the
   * process's embedding width for the fixed semantic indexes the home
   * carries; null when no embedding provider is configured, and the
   * home then carries no semantic indexes — the same width policy the
   * boot sequence applies (an index needs a width, and only a provider
   * has one).
   */
  createOntology(
    ontologyId: string,
    key: string,
    displayName: string | null,
    embeddingDimensions: number | null,
  ): Promise<Row>;

  listOntologies(): Promise<Row[]>;

  getOntology(key: string): Promise<Row | null>;

  getOntologyByDisplayName(displayName: string): Promise<Row | null>;

  /** Set the display name; the key never changes. Null = not found. */
  renameOntology(key: string, displayName: string): Promise<Row | null>;

  /** Hard cascade: the ontology's physical home and its registry entry
   * go together. False = not found. */
  deleteOntology(key: string): Promise<boolean>;
}

/**
 * The lifecycle surface every adapter package exports. The module IS the
 * namespace import — no wrapper object, no default export, no factory
 * class; TypeScript checks each `import()` result structurally at the
 * registry literal below.
 *
 * `createModelingStore`/`createRuntimeStore` return stores bound to one
 * ontology — every method resolves within that binding; the physical
 * mechanism is the adapter's private business. The port accessors below
 * verify the ontology exists (against the registry, the authoritative
 * list) before asking the adapter for a bound store, so adapters may
 * bind without checking. `ensureSemanticIndexes` covers every ontology
 * the registry lists and does nothing when there are none.
 */
export interface AdapterModule {
  supportsKeywordRanking(): boolean;
  /** Whether this adapter stores search indices. */
  supportsSearchIndices(): boolean;
  initAdapter(): Promise<void>;
  createModelingStore(ontologyKey: string): ModelingStore;
  createRuntimeStore(ontologyKey: string): RuntimeStore;
  /** Present exactly when `supportsSearchIndices()` is true. */
  createSearchIndexStore?(ontologyKey: string): SearchIndexStore;
  /** Present exactly when `supportsSearchIndices()` is true: call
   * `onWake` with the ontology key whenever search work was queued in any
   * server process on this database. */
  subscribeSearchWork?(onWake: (ontologyKey: string) => void): Promise<SearchWorkSubscription>;
  createRegistry(): OntologyRegistry;
  closeStores(): Promise<void>;
  ensureSemanticIndexes(dimensions: number): Promise<void>;
}

/**
 * The adapter registry: one thunk per backend, keyed by the `DB_BACKEND`
 * value. Registry values are thunks, so only the selected backend's
 * module and driver ever load.
 */
const ADAPTERS: Record<string, () => Promise<AdapterModule>> = {
  neo4j: () => import("../adapters/neo4j/index.js"),
  postgres: () => import("../adapters/postgres/index.js"),
};

let ontologyRegistry: OntologyRegistry | null = null;
let activeAdapter: AdapterModule | null = null;

function unknownBackend(): never {
  throw new Error(
    `Unknown DB_BACKEND '${settings.DB_BACKEND}' ` +
      `(supported: ${Object.keys(ADAPTERS).join(", ")})`,
  );
}

/** Initialize the configured persistence adapter and its registry. */
export async function initStores(): Promise<void> {
  const loadAdapter = ADAPTERS[settings.DB_BACKEND] ?? unknownBackend();
  const adapter = await loadAdapter();
  await adapter.initAdapter();
  ontologyRegistry = adapter.createRegistry();
  activeAdapter = adapter;
}

/** Close the active adapter; no-op if none. Never consults `DB_BACKEND`. */
export async function closeStores(): Promise<void> {
  if (activeAdapter !== null) {
    await activeAdapter.closeStores();
    activeAdapter = null;
  }
  ontologyRegistry = null;
}

/** Ensure the semantic-search indexes of every registered ontology exist
 * (startup hook). Zero ontologies: nothing happens. */
export async function ensureSemanticIndexes(dimensions: number): Promise<void> {
  if (activeAdapter === null) {
    throw new Error("Stores not initialized");
  }
  await activeAdapter.ensureSemanticIndexes(dimensions);
}

function requireAdapter(): AdapterModule {
  if (activeAdapter === null) {
    throw new Error("Stores not initialized");
  }
  return activeAdapter;
}

/** The binding check: an unknown ontology key fails with not-found. */
async function requireOntology(ontologyKey: string): Promise<Row> {
  const existing = await getOntologyRegistry().getOntology(ontologyKey);
  if (existing === null) {
    throw new NotFoundError(`Ontology '${ontologyKey}' not found`);
  }
  return existing;
}

/** A modeling store bound to one ontology. Unknown key -> not found. */
export async function getModelingStore(ontologyKey: string): Promise<ModelingStore> {
  const adapter = requireAdapter();
  await requireOntology(ontologyKey);
  return adapter.createModelingStore(ontologyKey);
}

/** A runtime store bound to one ontology. Unknown key -> not found. */
export async function getRuntimeStore(ontologyKey: string): Promise<RuntimeStore> {
  const adapter = requireAdapter();
  await requireOntology(ontologyKey);
  return adapter.createRuntimeStore(ontologyKey);
}

/** A search-index store bound to one ontology. Unknown key -> not found.
 * Callers check `supportsSearchIndices()` first; asking an adapter that
 * stores none is a programming error. */
export async function getSearchIndexStore(ontologyKey: string): Promise<SearchIndexStore> {
  const adapter = requireAdapter();
  if (adapter.createSearchIndexStore === undefined) {
    throw new Error("The active adapter does not store search indices");
  }
  await requireOntology(ontologyKey);
  return adapter.createSearchIndexStore(ontologyKey);
}

/** Subscribe to search-work wake-ups; null when the active adapter
 * stores no search indices. */
export async function subscribeSearchWork(
  onWake: (ontologyKey: string) => void,
): Promise<SearchWorkSubscription | null> {
  const adapter = requireAdapter();
  return adapter.subscribeSearchWork === undefined ? null : adapter.subscribeSearchWork(onWake);
}

export function getOntologyRegistry(): OntologyRegistry {
  if (ontologyRegistry === null) {
    throw new Error("Stores not initialized");
  }
  return ontologyRegistry;
}

/** The active adapter, or the configured one's module when the stores
 * are not initialized yet — for server-level declarations. */
async function declaringAdapter(): Promise<AdapterModule> {
  return activeAdapter ?? await (ADAPTERS[settings.DB_BACKEND] ?? unknownBackend())();
}

/** Server-level declaration, available even before an ontology exists. */
export async function supportsKeywordRanking(): Promise<boolean> {
  return (await declaringAdapter()).supportsKeywordRanking();
}

/** Server-level declaration: whether the active adapter stores search
 * indices. An adapter without them keeps its own search path. */
export async function supportsSearchIndices(): Promise<boolean> {
  return (await declaringAdapter()).supportsSearchIndices();
}
