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
 *
 * The `ModelingStore` and `RuntimeStore` interfaces below, together with
 * the conformance suite, are the authoritative contract — adapters are
 * peers under it; none is the reference implementation. An adapter
 * implements both interfaces (the Neo4j adapter does so in
 * `adapters/neo4j/modelingStore.ts` and `adapters/neo4j/runtimeStore.ts`)
 * and its package is registered as one thunk line in `ADAPTERS`.
 */

import { settings } from "../config.js";
import { NotFoundError } from "./exceptions.js";
import type { ValidatedQuery } from "./oql/index.js";
import type { PropertyDef, TypeKind } from "./schemas.js";

/** A raw store row: one entity, relation, or schema object as a plain map. */
export type Row = Record<string, unknown>;

/** The closed filter-operator vocabulary; a bare filter key means `eq`. */
export type FilterOperator = "eq" | "gt" | "gte" | "lt" | "lte" | "contains";

/**
 * One parsed, coerced filter condition. Built by the runtime service —
 * which validates the property, coerces the value, and checks the
 * operator above the port — so adapters receive only valid input and do
 * pure predicate assembly. The value is already coerced to the declared
 * data type (`contains` compares textually and carries the string form).
 */
export interface FilterCondition {
  key: string;
  dataType: string;
  op: FilterOperator;
  value: unknown;
}

/** One stored type whose key the active adapter now reserves. */
export interface ReservedTypeKeyInUse {
  kind: TypeKind;
  key: string;
}

/**
 * The modeling side of the persistence port: schema persistence.
 *
 * Capability grouping follows `docs/storage-adapters.md` ("The two store
 * surfaces"); the section comments below mirror it.
 */
export interface ModelingStore {
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

  createEntityType(
    entityTypeId: string,
    key: string,
    displayName: string,
    description: string | null,
  ): Promise<Row>;

  listEntityTypes(): Promise<Row[]>;

  getEntityType(entityTypeId: string): Promise<Row | null>;

  getEntityTypeByKey(key: string): Promise<Row | null>;

  updateEntityType(
    entityTypeId: string,
    displayName: string | null,
    description: string | null,
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
  // Document-property cleanup
  // ------------------------------------------------------------------

  /** Delete every chunk of one (entity type, document property) pair.
   * Invoked when the property, or its owning type, is removed. */
  deleteChunksForTypeProperty(entityTypeKey: string, propertyKey: string): Promise<void>;

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

  // ------------------------------------------------------------------
  // Embedding maintenance (rebuild support)
  // ------------------------------------------------------------------

  getEntityTypesWithProperties(): Promise<Row[]>;

  setEntityEmbedding(entityId: string, embedding: number[]): Promise<void>;

  listSavedQueryRefs(): Promise<Row[]>;

  setSavedQueryEmbedding(savedQueryId: string, embedding: number[]): Promise<void>;

  // ------------------------------------------------------------------
  // Vector-index DDL
  // ------------------------------------------------------------------

  createVectorIndex(
    entityTypeKey: string,
    dimensions: number,
    filterProperties?: string[] | null,
  ): Promise<void>;

  dropVectorIndex(entityTypeKey: string): Promise<void>;

  rebuildVectorIndex(entityTypeKey: string, dimensions: number): Promise<void>;

  createDocumentVectorIndex(
    entityTypeKey: string,
    propertyKey: string,
    dimensions: number,
  ): Promise<void>;

  dropDocumentVectorIndex(entityTypeKey: string, propertyKey: string): Promise<void>;

  ensureSavedQueryVectorIndex(dimensions: number): Promise<void>;

  ensureVectorIndexes(dimensions: number, recreateOnMismatch?: boolean): Promise<void>;
}

/**
 * The runtime side of the persistence port: instance-data persistence.
 *
 * Capability grouping follows `docs/storage-adapters.md` ("The two store
 * surfaces"); the section comments below mirror it.
 *
 * Filter-taking methods (`listEntities`, `listRelations`, and the
 * per-type entity search via `semanticSearch`) receive parsed, coerced
 * `FilterCondition`s built by the service — filter validation happens
 * above the port, so adapters receive only valid input and raise no
 * validation errors. Three reads carry the property definitions for row
 * decoding — `getEntityById`, `getEntitiesByIds`, and `getNeighbors` (an
 * adapter whose storage is self-describing may ignore them); listing
 * paths carry them for the same reason. `getEntity` and `getRelation`
 * carry none.
 */
export interface RuntimeStore {
  /** The ontology this store is bound to. The runtime schema cache keys
   * its entries by this binding plus the lens key. */
  readonly ontologyKey: string;

  // ------------------------------------------------------------------
  // Schema reading (for the runtime schema cache)
  // ------------------------------------------------------------------

  getFullSchema(lensKey: string): Promise<Row | null>;

  getAiAgentConfigs(lensKey: string): Promise<Row[]>;

  getSavedQueries(lensKey: string): Promise<Row[]>;

  // ------------------------------------------------------------------
  // Vector-index metadata validation
  // ------------------------------------------------------------------

  /** Reject property values the adapter's vector-index filter metadata
   * cannot hold. Synchronous; raises the domain `ValidationError`. An
   * adapter without such limits implements it as a no-op. */
  validateVectorIndexedProperties(
    entityTypeKey: string,
    properties: Row,
    filterProperties: string[],
    entityId?: string | null,
  ): void;

  // ------------------------------------------------------------------
  // Entity instances
  // ------------------------------------------------------------------

  createEntity(
    entityTypeKey: string,
    entityId: string,
    properties: Row,
    propertyDefs: Record<string, PropertyDef>,
    embedding?: number[] | null,
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
  ): Promise<Row | null>;

  deleteEntity(entityTypeKey: string, entityId: string): Promise<boolean>;

  // ------------------------------------------------------------------
  // Document chunks
  // ------------------------------------------------------------------

  getChunkEmbeddingsForEntityProperty(
    entityId: string,
    propertyKey: string,
  ): Promise<Record<string, number[]>>;

  deleteChunksForEntityProperty(entityId: string, propertyKey: string): Promise<void>;

  createDocumentChunks(
    entityId: string,
    entityTypeKey: string,
    propertyKey: string,
    chunks: Row[],
  ): Promise<void>;

  searchDocumentChunks(
    entityTypeKey: string,
    propertyKey: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<Row[]>;

  getEntitiesByIds(
    entityIds: string[],
    propertyDefs: Record<string, PropertyDef>,
  ): Promise<Record<string, Row>>;

  // ------------------------------------------------------------------
  // Semantic search
  // ------------------------------------------------------------------

  semanticSearch(
    entityTypeKey: string,
    propertyDefs: Record<string, PropertyDef>,
    queryEmbedding: number[],
    limit: number,
    minScore: number | null,
    filters?: FilterCondition[] | null,
  ): Promise<Row[]>;

  /** Search across all entity types at once. */
  semanticSearchAll(
    queryEmbedding: number[],
    limit: number,
    minScore: number | null,
  ): Promise<Row[]>;

  /** Rank SavedQuery descriptions for one lens by vector similarity. */
  searchSavedQueries(
    queryEmbedding: number[],
    lensKey: string,
    limit: number,
    minScore: number | null,
  ): Promise<Row[]>;

  // ------------------------------------------------------------------
  // Relation instances
  // ------------------------------------------------------------------

  createRelation(
    relationTypeKey: string,
    relationId: string,
    fromEntityId: string,
    toEntityId: string,
    properties: Row,
    propertyDefs: Record<string, PropertyDef>,
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
  ): Promise<Row | null>;

  deleteRelation(relationTypeKey: string, relationId: string): Promise<boolean>;

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
  initAdapter(): Promise<void>;
  createModelingStore(ontologyKey: string): ModelingStore;
  createRuntimeStore(ontologyKey: string): RuntimeStore;
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
async function requireOntology(ontologyKey: string): Promise<void> {
  const existing = await getOntologyRegistry().getOntology(ontologyKey);
  if (existing === null) {
    throw new NotFoundError(`Ontology '${ontologyKey}' not found`);
  }
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

export function getOntologyRegistry(): OntologyRegistry {
  if (ontologyRegistry === null) {
    throw new Error("Stores not initialized");
  }
  return ontologyRegistry;
}

// ---------------------------------------------------------------------------
// TRANSITIONAL: sole-ontology binding for the legacy surfaces
// ---------------------------------------------------------------------------

/**
 * The legacy `/mcp/*` mounts (ticket 17) do not yet name an ontology in
 * their URLs. Until they move, they bind to the server's sole ontology;
 * with zero or several ontologies they answer not-found, because no
 * binding can be inferred. Delete these two helpers when the MCP mounts
 * move.
 */
async function soleOntologyKey(): Promise<string> {
  const ontologies = await getOntologyRegistry().listOntologies();
  if (ontologies.length !== 1) {
    throw new NotFoundError(
      "This surface binds to the server's sole ontology, and the server " +
        `has ${ontologies.length} — address the ontology explicitly`,
    );
  }
  return ontologies[0]!["key"] as string;
}

/** @deprecated transitional — removed when `/mcp/*` moves (ticket 17). */
export async function getLegacyModelingStore(): Promise<ModelingStore> {
  return getModelingStore(await soleOntologyKey());
}

/** @deprecated transitional — removed when `/mcp/*` moves (ticket 17). */
export async function getLegacyRuntimeStore(): Promise<RuntimeStore> {
  return getRuntimeStore(await soleOntologyKey());
}
