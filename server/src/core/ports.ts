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
 * 2. Each method owns its connection. The exceptions are the stores
 *    `RuntimeStore.transaction` and `ModelingStore.changeDesign` hand to
 *    their work: every method of that store, and of the stores it hands
 *    out, runs on the transaction's one connection, and a pool checkout
 *    inside it is an assertion failure.
 * 3. Filtering, search, and sorting inputs are structured values, never
 *    query fragments.
 * 4. Driver exceptions never cross the port; adapters raise the domain
 *    exceptions from `core/exceptions`. Expected conditions are pre-checked
 *    by the services or expressed as `null` returns; anything left — lost
 *    connections, timeouts, index state, constraint violations the code did
 *    not anticipate — is raised as `StoreError`, whose message carries no
 *    storage detail. The adapter logs what it withheld against the error's
 *    `errorId`, which is what reaches the client.
 * 5. Adapters declare whether their search evaluates relation
 *    conditions — path conditions and relation existence — through
 *    `supportsSearchPathConditions()` on the runtime store, and the
 *    runtime service enforces the declaration: on an adapter declaring
 *    none, a query path or a relation existence test on search is
 *    rejected above the port, naming the entity list as the alternative.
 *
 * The `ModelingStore`, `RuntimeStore` and `SearchIndexStore` interfaces
 * below, together with the conformance suite, are the authoritative
 * contract. The adapter implements them (the PostgreSQL adapter in
 * `adapters/postgres/`) and its package is registered as one thunk line
 * in `ADAPTERS`.
 */

import type { KeywordLanguageSet } from "./keywordLanguage.js";
import type { NavigatorRecord, NavigatorWrite } from "./navigator.js";
import type { RetrieverRecord, RetrieverWrite } from "./retriever.js";

import { settings } from "../config.js";
import { NotFoundError } from "./exceptions.js";
import type { ValidatedQuery } from "./oql/index.js";
import type { NewPropertyDef, ParentEnd, PropertyDef, TypeKind } from "./schemas.js";
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

/** A relation rule the stored relations can break: under the parent
 * rules, an entity with more than one parent relation, or an entity on a
 * cycle (a self-loop included); under one per pair, a source and target
 * linked more than once by one relation type. */
export type RelationRule = "two_parents" | "cycle" | "duplicate_pair";

/** The violators of one relation rule: their count and the first five
 * entities, ordered by type and id. For `duplicate_pair` the count is the
 * number of pairs and each entity is a pair's source. */
export interface RelationRuleViolation {
  rule: RelationRule;
  count: number;
  entities: { type: string; id: string }[];
}

/** The rules of one relation type: its parent end, or null, and whether
 * one per pair holds. A parent end always holds one per pair. */
export interface RelationRules {
  parent: ParentEnd | null;
  onePerPair: boolean;
}

/** A rules write's outcome: the relation type row written, or the
 * violations that refused it, with nothing written. Only rules with
 * violators appear, `two_parents` first, then `cycle`, then
 * `duplicate_pair`. */
export type RelationRulesWrite = { row: Row } | { violations: RelationRuleViolation[] };

/**
 * The design revision of an ontology: its never-reused id and a number
 * every design change advances. A recreated ontology starts again at 1,
 * so only the pair tells two designs apart. Caches tag what they hold
 * with it; data writes check theirs under the design guard.
 */
export interface DesignRevision {
  ontologyId: string;
  revision: number;
}

/**
 * The modeling side of the persistence port: schema persistence.
 *
 * Capability grouping follows `docs/storage-adapters/stores.md` ("The two store
 * surfaces"); the section comments below mirror it.
 */
export interface ModelingStore {
  /** The search-index store of the same ontology: the modeling service
   * keeps the managed indices in step with the schema through it. */
  searchIndices(): SearchIndexStore;

  /** The navigator store of the same ontology. */
  navigators(): NavigatorStore;

  /** Run `work` as one design change: one transaction that holds the
   * ontology's design exclusively — data writes and other design changes
   * wait — and advances its revision; COMMIT when `work` returns,
   * ROLLBACK (the revision included) when it throws. The store handed to
   * `work`, and the search-index and navigator stores it hands out, run
   * on that transaction (contract rule 2). On a store already inside a
   * design change, `work` runs on it. */
  changeDesign<T>(work: (store: ModelingStore) => Promise<T>): Promise<T>;

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

  /** Also clears the derived identity of the type's orphaned entities,
   * in the same transaction. */
  deleteEntityType(entityTypeId: string): Promise<boolean>;

  /** Write the type's identity properties (ordered keys; null: no
   * identity), checked by the service. Entity type rows carry
   * `identityProperties`. Null result: no such type. */
  setEntityTypeIdentity(entityTypeId: string, identityProperties: string[] | null): Promise<Row | null>;

  /** Every stored entity of the type key, by id ascending, with the stored
   * values of `propertyKeys` (absent keys left out): what the service
   * builds the identities from. */
  readEntityValues(entityTypeKey: string, propertyKeys: string[]): Promise<{ id: string; values: Row }[]>;

  /** Write the derived identity of the entities listed (the service built
   * each); null clears it on every entity of the type key. The identity's
   * uniqueness is checked at the end of the design change. */
  writeEntityIdentities(entityTypeKey: string, identities: { id: string; identity: string }[] | null): Promise<void>;

  isEntityTypeReferenced(entityTypeId: string): Promise<boolean>;

  // ------------------------------------------------------------------
  // Relation types
  // ------------------------------------------------------------------

  /** Relation type rows carry their [relation rules](RelationRules):
   * `parent`, the parent end, or null for an ordinary relation type, and
   * `onePerPair`, true whenever `parent` is set. The create checks the
   * relation rows already stored under the key (deleting a relation type
   * keeps its instances) in its own transaction, before the insert: any
   * violator of a rule it sets refuses it and nothing is written. */
  createRelationType(
    relationTypeId: string,
    key: string,
    displayName: string,
    description: string | null,
    sourceEntityTypeKey: string,
    targetEntityTypeKey: string,
    rules: RelationRules,
  ): Promise<RelationRulesWrite>;

  listRelationTypes(): Promise<Row[]>;

  getRelationType(relationTypeId: string): Promise<Row | null>;

  getRelationTypeByKey(key: string): Promise<Row | null>;

  /** Null leaves a field unchanged. The rules are written by
   * `setRelationTypeRules`. */
  updateRelationType(
    relationTypeId: string,
    displayName: string | null,
    description: string | null,
  ): Promise<Row | null>;

  /** The rules write: `rules` is the relation type's whole new rule set.
   * In one transaction, a parent end set or flipped counts the violators
   * of the parent rules across every parent relation under the new
   * reading, and one per pair turned on counts the pairs the type's
   * stored relations link twice; any violator refuses the write and
   * nothing is written. Clearing a rule is never refused. Null result: no
   * such relation type. */
  setRelationTypeRules(
    relationTypeId: string,
    rules: RelationRules,
  ): Promise<RelationRulesWrite | null>;

  /** The violators of the relation rules in the stored relation rows
   * under `readings` (relation type key → its rules; a reading replaces
   * the stored rules of its key): the parent rules read across the stored
   * parent relations together with the readings' parent ends, and one per
   * pair for each reading that holds it. Empty when there are none.
   * Import's validation pre-pass runs it before any write. */
  findRelationRuleViolations(readings: Record<string, RelationRules>): Promise<RelationRuleViolation[]>;

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
  // Full schema (get_schema now; validation and export later)
  // ------------------------------------------------------------------

  getFullSchema(): Promise<Row>;

  // ------------------------------------------------------------------
  // Agent configs
  // ------------------------------------------------------------------

  listAgents(lensId: string): Promise<Row[]>;

  upsertAgent(
    lensId: string,
    agentConfigId: string,
    key: string,
    name: string,
    description: string | null,
    systemPrompt: string | null,
    tools: string[] | null,
  ): Promise<[Row, boolean]>;

  listAgentsForExport(lensId: string): Promise<Row[]>;

  deleteAgent(lensId: string, agentKey: string): Promise<boolean>;

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

  // ------------------------------------------------------------------
  // Vector-index lifecycle
  // ------------------------------------------------------------------

  /**
   * Drop every semantic index whose width no longer matches the model —
   * the saved-query index alone (search-index generations record their
   * own model and width).
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
   * at `dimensions` — as above, the saved-query index alone. An index
   * whose width has drifted is REPORTED and
   * left alone — repair belongs to the rebuild, through the method above.
   */
  ensureVectorIndexes(dimensions: number): Promise<void>;
}

/**
 * The runtime side of the persistence port: instance-data persistence.
 *
 * Capability grouping follows `docs/storage-adapters/stores.md` ("The two store
 * surfaces"); the section comments below mirror it.
 *
 * Filter-taking methods (`listEntities`, `listRelations`, and the
 * search-index ranking) receive parsed, coerced `FilterCondition`s built by the service — filter
 * validation happens above the port, so adapters receive only valid
 * input and raise no validation errors. A path or relation existence
 * condition reaches a search only where the adapter declares support
 * (contract rule 5). Three reads carry the property definitions for row
 * decoding — `getEntityById`, `getEntitiesByIds`, and `getNeighbors` (an
 * adapter whose storage is self-describing may ignore them); listing
 * paths carry them for the same reason. `getEntity` and `getRelation`
 * carry none.
 */
export interface SearchedType {
  entityTypeKey: string;
  propertyDefs: Record<string, PropertyDef>;
  conditions: FilterCondition[];
}

/** The keyword retrieval method: any admits a row carrying any query term, all
 * requires every query term; both match each term as a prefix. Contract:
 * `docs/storage-adapters/search-index-store.md` (ranking entries). */
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
   * document passages (contract rule 5). Declared as a plain flag so the
   * service can reject such a filter on search without knowing why the
   * adapter cannot evaluate it. */
  supportsSearchPathConditions(): boolean;
  /** Whether search can rank by keyword — through the search indices. */
  supportsKeywordRanking(): boolean;

  // ------------------------------------------------------------------
  // Schema reading (for the runtime schema cache)
  // ------------------------------------------------------------------

  /** The ontology's current design revision; takes no lock. */
  designRevision(): Promise<DesignRevision>;

  /** Unfiltered: the adapter never applies the inclusions. Null when no
   * lens has the key. Contract: `docs/storage-adapters/stores.md`, "Schema reading".
   * Carries `searchIndexInclusions`, the keys of the indices the lens
   * includes, and `design`, the design revision of the same snapshot. */
  getFullSchemaWithLensInclusions(lensKey: string): Promise<Row | null>;

  getAgentConfigs(lensKey: string): Promise<Row[]>;

  getSavedQueries(lensKey: string): Promise<Row[]>;

  // ------------------------------------------------------------------
  // Search indices
  // ------------------------------------------------------------------

  /** The search-index store of the same ontology. */
  searchIndices(): SearchIndexStore;

  /** The navigator store of the same ontology. */
  navigators(): NavigatorStore;

  /** The ruleset store of the same ontology. */
  rulesets(): RulesetStore;

  /** The changeset store of the same ontology. */
  changesets(): ChangesetStore;

  // ------------------------------------------------------------------
  // Transactions
  // ------------------------------------------------------------------

  /** Run `work` on a store bound to one transaction on one connection:
   * COMMIT when it returns, ROLLBACK when it throws. The transaction first
   * holds the ontology's design shared — design changes wait for it, other
   * writes do not — and throws `DesignChangedError` unless the design is
   * still `design`, so nothing commits against a design that changed.
   * Every read and write of the bound store, its ruleset and changeset
   * stores included, uses that connection (contract rule 2's exception).
   * Anything that would take a second connection inside it — a nested
   * `transaction`, `getFullSchemaWithLensInclusions` (its own REPEATABLE
   * READ), the search-index or navigator store — is an assertion failure. */
  transaction<T>(design: DesignRevision, work: (store: RuntimeStore) => Promise<T>): Promise<T>;

  // ------------------------------------------------------------------
  // Entity instances
  //
  // Each write takes an optional `search` plan: the search work the write
  // causes (`core/searchDependencies.ts`). The adapter applies it in the
  // write's own transaction, so the work is queued exactly when the write
  // commits.
  // ------------------------------------------------------------------

  /** `identity`: the entity's derived identity, built by the service;
   * null when its type has none. A taken one raises the identity
   * conflict (`IdentityTakenError`) and writes nothing. Entity rows carry
   * `_identity` when the entity has one. */
  createEntity(
    entityTypeKey: string,
    entityId: string,
    properties: Row,
    propertyDefs: Record<string, PropertyDef>,
    search?: SearchWritePlan | null,
    identity?: string | null,
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

  /** Up to `limit` distinct values of one property among the entities of
   * a type, as text, in ascending order; an entity without a value, or
   * with an empty one, contributes none. */
  distinctEntityValues(entityTypeKey: string, propertyKey: string, limit: number): Promise<string[]>;

  getEntity(entityTypeKey: string, entityId: string): Promise<Row | null>;

  /** The entity of the type whose identity is exactly `identity`, as
   * `getEntity` returns it; null when none has it. */
  getEntityByIdentity(entityTypeKey: string, identity: string): Promise<Row | null>;

  /** The entities of the type that have one of `identities`, as id and
   * identity. Inside a transaction whose identity check is deferred
   * (`setIdentityCheck`) an identity may be held twice. */
  entitiesWithIdentities(entityTypeKey: string, identities: string[]): Promise<{ id: string; identity: string }[]>;

  /** The stored relations of the type that link one of `pairs`, source
   * to target, as id and ends; a pair may come back more than once. */
  relationsOfPairs(
    relationTypeKey: string,
    pairs: { fromId: string; toId: string }[],
  ): Promise<{ id: string; fromId: string; toId: string }[]>;

  /** Lock the pairs, source to target, of a one-per-pair relation type
   * until the transaction ends, so that concurrent writes of them, on any
   * server, take turns; then answer the stored relations of the type that
   * link them, as `relationsOfPairs`. Only meaningful on a transaction's
   * store. */
  lockPairs(
    relationTypeKey: string,
    pairs: { fromId: string; toId: string }[],
  ): Promise<{ id: string; fromId: string; toId: string }[]>;

  /** When this transaction checks that an identity is unique within its
   * type: `deferred` at its end, `immediate` now (a duplicate is an
   * `IdentityTakenError`) and at every later statement. Only on a bound
   * store. */
  setIdentityCheck(mode: "deferred" | "immediate"): Promise<void>;

  getEntityById(
    entityId: string,
    propertyDefs: Record<string, PropertyDef>,
  ): Promise<Row | null>;

  /** `identity`, when given, replaces the entity's identity (the service
   * built it from the values the update leaves); omitted leaves it. A
   * taken one raises the identity conflict, as `createEntity`. */
  updateEntity(
    entityTypeKey: string,
    entityId: string,
    setProperties: Row,
    removeProperties: string[],
    propertyDefs: Record<string, PropertyDef>,
    search?: SearchWritePlan | null,
    identity?: string,
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
  // Saved-query discovery
  // ------------------------------------------------------------------

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
  // Batch writes
  //
  // Many writes of one kind in a few statements, as the commit of a
  // changeset applies them; each row as the single write takes it, its
  // own `search` plan included, queued in the same transaction exactly
  // when its row is written (a delete's before it). A batch answers the
  // ids it wrote; a row it did not write is left out. Only on a bound
  // store.
  // ------------------------------------------------------------------

  /** As `createEntity`, each row. Under a deferred identity check a taken
   * identity is judged at the transaction's end. */
  createEntities(rows: EntityCreateRow[]): Promise<void>;

  /** As `updateEntity`, each row; answers the ids updated, a row whose
   * entity is gone left out. */
  updateEntities(rows: EntityUpdateRow[]): Promise<string[]>;

  /** As `deleteEntity`, each row; answers the ids deleted. */
  deleteEntities(rows: InstanceDeleteRow[]): Promise<string[]>;

  /** As `createRelation`, each row; answers the ids created, a row whose
   * source or target entity does not exist left out. */
  createRelations(rows: RelationCreateRow[]): Promise<string[]>;

  /** As `updateRelation`, each row; answers the ids updated. */
  updateRelations(rows: RelationUpdateRow[]): Promise<string[]>;

  /** As `deleteRelation`, each row; answers the ids deleted. */
  deleteRelations(rows: InstanceDeleteRow[]): Promise<string[]>;

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

  /** One page of neighbours over the named relation types only — the
   * type filter applies before `limit`, so the page holds no relation the
   * caller would drop. `null` reads every relation type; an empty list
   * answers without touching storage. */
  getNeighbors(
    entityId: string,
    direction: string,
    relationTypeKeys: string[] | null,
    limit: number,
    propertyDefsByType: Record<string, Record<string, PropertyDef>>,
  ): Promise<Row[]>;

  // ------------------------------------------------------------------
  // Hierarchy
  //
  // Both reads take the parent relations to follow as `readings`
  // (relation type key → parent end); the service passes every parent
  // relation of the full schema. Empty readings answer without touching
  // storage.
  // ------------------------------------------------------------------

  /** The ancestor walk: the entity's parent, its parent's parent and so
   * on up to a root, nearest first, as `{type, id}`. The entity itself is
   * never in it. One recursive statement with a cycle guard, so it ends on
   * any data; each ancestor appears once, at its nearest level. On data
   * that breaks the parent rules (the accepted race), a level can hold
   * more than one entity, ordered by type and id. Empty for a root or an
   * unknown id. */
  getAncestors(
    entityId: string,
    readings: Record<string, ParentEnd>,
  ): Promise<{ type: string; id: string }[]>;

  /** The children lookup: whether the entity is the parent end of at
   * least one relation of `readings`. */
  hasChildren(entityId: string, readings: Record<string, ParentEnd>): Promise<boolean>;

  /** The create with a parent relation: the entity, then the relation
   * that names its parent, in one transaction, each with its own search
   * work as `createEntity` and `createRelation` apply it. The service has
   * validated both; the relation's FK holds the parent, so a parent that
   * vanished meanwhile fails the whole write and nothing is stored. */
  createEntityWithParent(
    entity: {
      entityTypeKey: string;
      entityId: string;
      properties: Row;
      propertyDefs: Record<string, PropertyDef>;
      search?: SearchWritePlan | null;
      identity?: string | null;
    },
    relation: {
      relationTypeKey: string;
      relationId: string;
      fromEntityId: string;
      toEntityId: string;
      properties: Row;
      propertyDefs: Record<string, PropertyDef>;
      search?: SearchWritePlan | null;
    },
  ): Promise<{ entity: Row; relation: Row }>;

  // ------------------------------------------------------------------
  // Neutral reads for a changeset's checks and commit validation
  //
  // They evaluate no rule: the service does. The hierarchy ones take
  // `readings` as the hierarchy reads do. Off-format ids match nothing.
  // A read taking `documentKeys` (entity type key → its document
  // property keys) returns each string stored under such a key as its
  // fingerprint, `{sha256, length}`: the hex SHA-256 of its UTF-8 bytes
  // and its length in characters (code points), never its text.
  // ------------------------------------------------------------------

  /** The entities of `ids`, by id, as `getEntitiesByIds` returns them
   * without property definitions, but each document value as its
   * fingerprint; an unknown id is left out. */
  getEntitiesByIdsHashed(ids: string[], documentKeys: Record<string, string[]>): Promise<Record<string, Row>>;

  /** The relations of `ids`, of any type, by id, as `getRelation` returns
   * them; an unknown id is left out. */
  getRelationsByIds(ids: string[]): Promise<Record<string, Row>>;

  /** The type key of each entity of `ids`, by id; an unknown id is left
   * out. No property is read. */
  getEntityTypes(ids: string[]): Promise<Record<string, string>>;

  /** The parent relations whose child end is one of `ids`. */
  parentsOf(ids: string[], readings: Record<string, ParentEnd>): Promise<ParentLink[]>;

  /** The parent relations whose parent end is one of `ids`. `lock` takes
   * the entities of `ids` and the relations found `FOR UPDATE` — no child
   * can attach until the transaction ends; it locks the entities even
   * when `readings` is empty. */
  childrenOf(ids: string[], readings: Record<string, ParentEnd>, lock?: boolean): Promise<ParentLink[]>;

  /** The entities and relations of `ids`, taken `FOR UPDATE`, with their
   * stored properties as stored, each document value as its fingerprint;
   * an unknown id is left out. */
  lockTargets(ids: string[], documentKeys: Record<string, string[]>): Promise<LockedTarget[]>;
}

/** One stored parent relation, read neutrally: its parent and child end. */
export interface ParentLink {
  relationType: string;
  relationId: string;
  parentId: string;
  childId: string;
}

/** One instance locked by `lockTargets`. */
export interface LockedTarget {
  id: string;
  kind: "entity" | "relation";
  typeKey: string;
  /** The stored properties, raw: no datetime decoding; a document value
   * as its fingerprint. */
  props: Row;
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
  /** Rank only entries of these parts; absent or null: of every part. */
  partKinds?: readonly SearchPartKind[] | null;
  limit: number;
}

/** One ranked entry. `score` is `(1 + cosine) / 2` for a semantic
 * generation and, for a keyword one, the query words the entry holds plus
 * the adapter's native keyword measurement as a fraction below 1. */
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
  /** The lease this claim wrote — opaque, the claim's fencing token. A
   * later claim of the item (a takeover of an expired lease) writes a
   * later one, and the effects of the claim it replaced are dropped. */
  lease: string;
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
/** One entity a batch creates (`createEntities`). */
export interface EntityCreateRow {
  entityTypeKey: string;
  entityId: string;
  properties: Row;
  propertyDefs: Record<string, PropertyDef>;
  identity: string | null;
  search: SearchWritePlan | null;
}

/** One entity a batch updates (`updateEntities`); `identity` as for
 * `updateEntity`. */
export interface EntityUpdateRow {
  entityTypeKey: string;
  entityId: string;
  setProperties: Row;
  removeProperties: string[];
  propertyDefs: Record<string, PropertyDef>;
  identity?: string;
  search: SearchWritePlan | null;
}

/** One relation a batch creates (`createRelations`). */
export interface RelationCreateRow {
  relationTypeKey: string;
  relationId: string;
  fromEntityId: string;
  toEntityId: string;
  properties: Row;
  propertyDefs: Record<string, PropertyDef>;
  search: SearchWritePlan | null;
}

/** One relation a batch updates (`updateRelations`). */
export interface RelationUpdateRow {
  relationTypeKey: string;
  relationId: string;
  setProperties: Row;
  removeProperties: string[];
  propertyDefs: Record<string, PropertyDef>;
  search: SearchWritePlan | null;
}

/** One entity or relation a batch deletes, by its type key and id. */
export interface InstanceDeleteRow {
  typeKey: string;
  id: string;
  search: SearchWritePlan | null;
}

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
 * generations and the entries a generation holds.
 *
 * A generation is one build of one representation of one index. It fills
 * beside the active one, and `finishGeneration` makes it the active one in
 * a single step; the previous one then retires and its entries go. Entry
 * writes go to a generation by id wherever it is in that lifecycle, and
 * are refused (false) once it is no longer building or ready.
 */
/**
 * Navigators (`core/navigator.ts`), lens-local: keyed by lens and key,
 * deleted with their lens. The store keeps the configuration as given;
 * the navigator's runtime checks it.
 */
export interface NavigatorStore {
  /** The lens's navigators, by name then key. */
  listNavigators(lensId: string): Promise<NavigatorRecord[]>;

  getNavigator(lensId: string, key: string): Promise<NavigatorRecord | null>;

  /** Create, or replace name, description and configuration of the
   * navigator with this key (its id and creation time stay). `createOnly`:
   * an existing key is a `ConflictError`. The lens missing is a
   * `NotFoundError`. True in the pair when the navigator was created. */
  saveNavigator(lensId: string, navigator: NavigatorWrite, createOnly: boolean): Promise<[NavigatorRecord, boolean]>;

  /** False when the lens has no navigator of this key. */
  deleteNavigator(lensId: string, key: string): Promise<boolean>;
}

/** The entity an anchor points at: its type's key and its id. */
export interface AnchorEntity {
  type: string;
  id: string;
}

/** How a connection through a ruleset may change data: each level allows
 * everything the one before it does. */
export type WriteAccess = "none" | "propose" | "full";

/** One stored ruleset, read with a join to `entity`. */
export interface RulesetRecord {
  key: string;
  /** Null when the ruleset has no anchor. */
  anchor: AnchorEntity | null;
  /** Whether an entity of that id and type is stored; false without an anchor. */
  anchorFound: boolean;
  writeAccess: WriteAccess;
}

/** The rules a save writes; an absent rule keeps its stored value. */
export interface RulesetPatch {
  /** Null removes the anchor. */
  anchor?: AnchorEntity | null;
  writeAccess?: WriteAccess;
}

/**
 * Rulesets: named sets of rules, operational state of the ontology beside
 * its instances. The store keeps the anchor as given and never checks it;
 * the ruleset service decides its state.
 */
export interface RulesetStore {
  /** Every ruleset, by key. */
  list(): Promise<RulesetRecord[]>;

  get(key: string): Promise<RulesetRecord | null>;

  /** Create the ruleset, or change it; the record as written, read with
   * the join. Each rule the patch names is written, the others keep their
   * stored value; a new ruleset has no anchor and write access `full`. */
  save(key: string, patch: RulesetPatch): Promise<RulesetRecord>;

  /** False when no ruleset has this key. */
  delete(key: string): Promise<boolean>;
}

/** One changeset: what a commit of one lens will apply, bound to the lens
 * and to the ruleset of the URL that started it. */
export interface ChangesetRecord {
  id: string;
  lensId: string;
  /** What people call it by: the lens's highest number at its start plus
   * one. Shown only; never looked up. */
  number: number;
  /** Null when started through the plain lens URL. */
  rulesetKey: string | null;
  version: number;
  note: string | null;
  /** Null for a draft. */
  submittedAt: Date | null;
  createdAt: Date;
  lastChangeAt: Date;
  /** The number of staged objects. */
  objectCount: number;
}

/** A changeset as the list shows it. */
export interface ChangesetSummary extends ChangesetRecord {
  /** Staged objects per operation: `<action>_<kind>`, as `create_entity`. */
  operations: Record<string, number>;
  /** The type keys the staged objects name, sorted. */
  typeKeys: string[];
}

export type StagedKind = "entity" | "relation";
export type StagedAction = "create" | "update" | "delete";

/** One entity or relation a changeset touches, as the service hands it
 * over. */
export interface NewStagedObject {
  objectId: string;
  kind: StagedKind;
  typeKey: string;
  action: StagedAction;
  /** A relation's ends; null for an entity. */
  fromId: string | null;
  toId: string | null;
}

/** One staged property value of a staged object: plain JSON, kept as
 * given. */
export interface NewStagedValue {
  objectId: string;
  propertyKey: string;
  /** JSON null removes the property (an update only). */
  value: unknown;
  /** The stored value at the key's first touch, as the service encodes
   * it; null when the object is created in the changeset. */
  before: Row | null;
  /** Its size as the service counts it toward the byte cap. */
  bytes: number;
}

export type StagedValueRecord = Omit<NewStagedValue, "objectId">;

export interface StagedObjectRecord extends NewStagedObject {
  firstTouchedAt: Date;
  /** Its staged values, by property key. */
  values: StagedValueRecord[];
}

/** One change of a changeset's staged objects, applied all or none in
 * this order: objects removed with their values, values removed, objects
 * written, values written. */
export interface ChangesetChange {
  removeObjects?: string[];
  removeValues?: { objectId: string; propertyKey: string }[];
  /** A new object is added, touched first now; an existing one gets the
   * action given and keeps everything else. */
  objects?: NewStagedObject[];
  /** Each value written whole, replacing the one stored under its key. */
  values?: NewStagedValue[];
}

/**
 * Changesets, their staged objects and values. The store keeps what it is
 * given and evaluates no rule; the changeset service decides. Every
 * mutation except `touch` and `sweep` takes the changeset row `FOR UPDATE
 * NOWAIT` — a held row is a `ConflictError`, never a wait — bumps
 * `version` and refreshes `lastChangeAt`. Off-format ids match nothing.
 */
export interface ChangesetStore {
  start(changeset: { id: string; lensId: string; rulesetKey: string | null; note: string | null }): Promise<ChangesetRecord>;

  /** Through its binding: null when the changeset belongs to another lens
   * or, with a `rulesetKey`, to another ruleset. A null `rulesetKey` (the
   * plain lens URL) reaches every changeset of the lens. */
  get(id: string, lensId: string, rulesetKey: string | null): Promise<ChangesetRecord | null>;

  /** The lens's changesets, bound as `get`, by number, lowest first. */
  list(lensId: string, rulesetKey: string | null): Promise<ChangesetSummary[]>;

  /** The staged objects with their values, by first touch. */
  page(id: string, offset: number, limit: number): Promise<StagedObjectRecord[]>;

  /** The staged objects of `objectIds` with their values; an id not
   * staged is left out. */
  objects(id: string, objectIds: string[]): Promise<StagedObjectRecord[]>;

  /** The ids of the staged relations with an end at `entityId`. */
  relationsAt(id: string, entityId: string): Promise<string[]>;

  /** The staged entity creates and updates of `typeKey` that stage a
   * value under at least one key of `values` and, under each key of
   * `values` they stage, exactly its value; with their values, by first
   * touch. */
  entityObjectsStaging(id: string, typeKey: string, values: Row): Promise<StagedObjectRecord[]>;

  /** The staged entity objects of `typeKey`, each with its values under
   * `keys` only, by first touch. */
  entityObjectsKeyed(id: string, typeKey: string, keys: string[]): Promise<StagedObjectRecord[]>;

  /** The staged relation objects of `typeKey` whose ends, source to
   * target, are one of `pairs`, without their values, by first touch. */
  relationObjectsAt(id: string, typeKey: string, pairs: { fromId: string; toId: string }[]): Promise<StagedObjectRecord[]>;

  /** The sum of the `bytes` of its staged values; 0 when it has none or
   * is gone. */
  stagedBytes(id: string): Promise<number>;

  /** Compare-and-set on the version of a draft changeset: applies the
   * change. Null when the version differs, the changeset is submitted, or
   * it is gone. */
  apply(id: string, expectedVersion: number, change: ChangesetChange): Promise<ChangesetRecord | null>;

  /** Compare-and-set on the version of a draft changeset: sets
   * `submittedAt` and the note. Null when the version differs, the
   * changeset is submitted, or it is gone. */
  submit(id: string, expectedVersion: number, note: string | null): Promise<ChangesetRecord | null>;

  /** A submitted changeset back to draft, with the note given. Null when
   * the changeset is a draft or gone. */
  unsubmit(id: string, note: string): Promise<ChangesetRecord | null>;

  /** The changeset and its staged objects, while a draft; false when it
   * is gone or submitted. */
  discard(id: string): Promise<boolean>;

  /** Refresh the last change only, keeping the version; skipped while
   * another transaction holds the row. */
  touch(id: string): Promise<void>;

  /** Delete the draft changesets of the ontology last changed more than
   * `idleMs` ago by the database's clock, skipping any whose row is held;
   * how many. */
  sweep(idleMs: number): Promise<number>;

  /** Inside a bound store only: the ontology's commit lock, a
   * transaction-scoped advisory lock taken with try semantics, then the
   * row `FOR UPDATE NOWAIT`. Either one held elsewhere is a
   * `ConflictError`. Null when the changeset is gone. From here on, the
   * transaction waits at most 5 s for a row another transaction holds;
   * a longer wait is a `ConflictError`. */
  lockForCommit(id: string): Promise<ChangesetRecord | null>;

  /** Delete the changeset with its staged objects. */
  deleteCommitted(id: string): Promise<void>;
}

export interface SearchIndexStore {
  /** The ontology this store is bound to. */
  readonly ontologyKey: string;

  /** The ontology's current design revision; takes no lock. */
  designRevision(): Promise<DesignRevision>;

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
  // Retrievers (lens-local; they search this store's indices)
  //
  // Keyed by lens and retriever key; deleted with their lens. A transfer
  // never overwrites a target.
  // ------------------------------------------------------------------

  /** The lens's retrievers, by name then key. */
  listRetrievers(lensId: string): Promise<RetrieverRecord[]>;

  getRetriever(lensId: string, key: string): Promise<RetrieverRecord | null>;

  /** Create, or replace name, description, configuration and warnings of
   * the retriever with this key (its id and creation time stay). `createOnly`:
   * an existing key is a `ConflictError`. The lens missing is a
   * `NotFoundError`. True in the pair when the retriever was created. */
  saveRetriever(
    lensId: string,
    retriever: RetrieverWrite,
    createOnly: boolean,
  ): Promise<[RetrieverRecord, boolean]>;

  /** False when the lens has no retriever with this key. */
  deleteRetriever(lensId: string, key: string): Promise<boolean>;

  /** Copy (`copyId`: the copy's id) or move (`copyId` null: identity kept)
   * a retriever to another lens and key, atomically. The source must still
   * hold `expectedConfig` (JSON of `[configVersion, config]`) — else a
   * `ConflictError`; a taken target key is a `ConflictError`. */
  transferRetriever(
    sourceLensId: string,
    sourceKey: string,
    targetLensId: string,
    targetKey: string,
    copyId: string | null,
    expectedConfig: string,
  ): Promise<RetrieverRecord>;

  // ------------------------------------------------------------------
  // Generations
  // ------------------------------------------------------------------

  /**
   * Start a building generation, holding the ontology's design
   * exclusively, so no data write runs between the backfill and the
   * generation becoming visible to writes. A generation still building for
   * the same index and representation is superseded: it retires with its
   * queued work and entries. Null, with nothing created, when the index
   * does not exist, when the design is no longer `design` (the change that
   * moved it reconciles), or — unless `force` — when a building or ready
   * generation of the index and representation already matches.
   *
   * `backfillEntityType` queues every entity of that type (one `entity`
   * item each) in the same transaction and sets `total` to their count —
   * a generation never appears with an empty queue that is not yet filled.
   */
  createGeneration(
    generation: NewSearchGeneration,
    options: { design: DesignRevision; backfillEntityType?: string; force?: boolean },
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
   * its queued work and entries. False when it is neither, or when the
   * design is no longer `design`. */
  retireGeneration(generationId: string, design: DesignRevision): Promise<boolean>;

  /** Remove the entries storage of every generation that is neither
   * building nor ready — what an interrupted retirement or an entity type
   * cascade left behind. Idempotent. */
  sweepGenerations(): Promise<void>;

  // ------------------------------------------------------------------
  // Entries (the pipeline's surface)
  // ------------------------------------------------------------------

  /** Insert or replace entries of one generation by identity; the count
   * written. Null (and nothing written) when the generation is no longer
   * building or ready. An identity may appear once per call. With `claim`
   * (the worker's claimed items of the generation), only the entities whose
   * claimed items the claim still all holds are written; the others were
   * taken over or withdrawn by a write, and stay as they are. */
  upsertEntries(
    generationId: string,
    entries: SearchEntryWrite[],
    claim?: ClaimedSearchQueueItem[],
  ): Promise<number | null>;

  /** The stored text hashes of those of `parts` that exist. */
  readEntryHashes(generationId: string, parts: SearchEntryPart[]): Promise<SearchEntryHash[]>;

  /** Delete entries of one generation by identity; the count deleted.
   * `claim` as for `upsertEntries`. */
  deleteEntries(
    generationId: string,
    parts: SearchEntryPart[],
    claim?: ClaimedSearchQueueItem[],
  ): Promise<number>;

  /** Delete one generation's entries of one entity, part kind and group
   * whose part id is not in `keepPartIds` — the passages past a shortened
   * document, the relations that are gone. The count deleted. `claim` as
   * for `upsertEntries`. */
  deleteEntityPartsExcept(
    generationId: string,
    entityId: string,
    partKind: SearchPartKind,
    groupNo: number,
    keepPartIds: string[],
    claim?: ClaimedSearchQueueItem[],
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
   * `RuntimeStore.getFullSchemaWithLensInclusions` returns them in — with
   * the index definitions (`indices`) and the design revision (`design`)
   * of the same snapshot. */
  readFullSchema(): Promise<Row>;

  /** Queue every entity of a type, as one `entity` item each, into the
   * given generations (those no longer building or ready are skipped).
   * The count of items queued. */
  enqueueEntityType(generationIds: string[], entityTypeKey: string): Promise<number>;

  /** Lease up to `limit` claimable items — due, not leased (or the lease
   * expired), attempts below `maxAttempts`, of a building or ready
   * generation — keyword items first, then oldest first. Semantic items
   * are claimed only for generations of `semanticModelId` (none when
   * null). Items another worker holds are skipped, never waited for.
   *
   * A claim holds an item while the item still carries the claim's lease.
   * Settling a claim (complete, fail, release) and the entry writes made
   * for it act only on what it holds, and only for entities whose claimed
   * items it all holds; what it lost was taken over, or withdrawn by a
   * write that deleted it. */
  claimQueueItems(options: {
    limit: number;
    leaseSeconds: number;
    maxAttempts: number;
    semanticModelId: string | null;
  }): Promise<ClaimedSearchQueueItem[]>;

  /** Remove processed items — unless one was enqueued again since its
   * claim; that one stays, released for the next claim, like every other
   * item still held. The count removed, and the count no longer held. */
  completeQueueItems(items: ClaimedSearchQueueItem[]): Promise<{ completed: number; lost: number }>;

  /** Record a failed attempt: attempts + 1, the error, release the lease
   * and hold each item back by its delay. The attempts of each item
   * charged, and the count no longer held. */
  failQueueItems(
    failures: { item: ClaimedSearchQueueItem; delayMs: number }[],
    error: string,
  ): Promise<{ attempts: number[]; lost: number }>;

  /** Release the items still held, charging nothing: the next claim takes
   * them at once. The count released. */
  releaseQueueItems(items: ClaimedSearchQueueItem[]): Promise<number>;

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
  initAdapter(): Promise<void>;
  createModelingStore(ontologyKey: string): ModelingStore;
  createRuntimeStore(ontologyKey: string): RuntimeStore;
  createSearchIndexStore(ontologyKey: string): SearchIndexStore;
  /** Call `onWake` with the ontology key whenever search work was queued
   * in any server process on this database. */
  subscribeSearchWork(onWake: (ontologyKey: string) => void): Promise<SearchWorkSubscription>;
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

/** A search-index store bound to one ontology. Unknown key -> not found. */
export async function getSearchIndexStore(ontologyKey: string): Promise<SearchIndexStore> {
  const adapter = requireAdapter();
  await requireOntology(ontologyKey);
  return adapter.createSearchIndexStore(ontologyKey);
}

/** Subscribe to search-work wake-ups. */
export async function subscribeSearchWork(
  onWake: (ontologyKey: string) => void,
): Promise<SearchWorkSubscription> {
  return requireAdapter().subscribeSearchWork(onWake);
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
