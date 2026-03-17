import type {
  ClientOptions,
  OntologyOverride,
  RuntimeSchema,
  EntityType,
  RelationType,
  EntityInstance,
  RelationInstance,
  PaginatedResponse,
  NeighborhoodResponse,
  SemanticSearchResponse,
  CypherQueryResult,
  FeaturesResponse,
  ListEntityParams,
  ListRelationParams,
  NeighborParams,
  SemanticSearchParams,
  GetEntityParams,
} from './types.js';
import { OntoForgeError } from './errors.js';
import { httpRequest, buildQuery, type FetchFn } from './http.js';

/**
 * Client for the OntoForge Runtime API.
 *
 * @example
 * ```ts
 * const client = new OntoForgeRuntime({
 *   baseUrl: 'http://localhost:8000',
 *   ontology: 'my_ontology',
 * });
 *
 * const people = await client.listEntities('person', { limit: 10 });
 * ```
 */
export class OntoForgeRuntime {
  private readonly baseUrl: string;
  private readonly defaultOntology?: string;
  private readonly fetchFn: FetchFn;

  constructor(options: ClientOptions) {
    // Strip trailing slash for consistent URL building.
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.defaultOntology = options.ontology;
    this.fetchFn = options.fetch ?? ((...args: Parameters<FetchFn>) => fetch(...args));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private resolveOntology(override?: OntologyOverride): string {
    const key = override?.ontology ?? this.defaultOntology;
    if (!key) {
      throw new OntoForgeError(
        'No ontology specified. Provide one in the constructor or pass { ontology } to this method.',
        0,
        'VALIDATION_ERROR',
      );
    }
    return key;
  }

  private runtimeUrl(ontology: string, path: string): string {
    return `${this.baseUrl}/api/runtime/${ontology}${path}`;
  }

  private globalUrl(path: string): string {
    return `${this.baseUrl}/api/runtime${path}`;
  }

  private get<T>(url: string): Promise<T> {
    return httpRequest<T>(this.fetchFn, url);
  }

  private post<T>(url: string, body: unknown): Promise<T> {
    return httpRequest<T>(this.fetchFn, url, { method: 'POST', body });
  }

  private patch<T>(url: string, body: unknown): Promise<T> {
    return httpRequest<T>(this.fetchFn, url, { method: 'PATCH', body });
  }

  private del(url: string): Promise<void> {
    return httpRequest<void>(this.fetchFn, url, { method: 'DELETE' });
  }

  // -------------------------------------------------------------------------
  // Features (global — no ontology required)
  // -------------------------------------------------------------------------

  /** Check which optional features (e.g. semantic search) are available. */
  features(): Promise<FeaturesResponse> {
    return this.get(this.globalUrl('/features'));
  }

  // -------------------------------------------------------------------------
  // Schema introspection
  // -------------------------------------------------------------------------

  /** Get the full schema for the ontology. */
  getSchema(options?: OntologyOverride): Promise<RuntimeSchema> {
    const o = this.resolveOntology(options);
    return this.get(this.runtimeUrl(o, '/schema'));
  }

  /** List all entity types in the ontology. */
  getEntityTypes(options?: OntologyOverride): Promise<EntityType[]> {
    const o = this.resolveOntology(options);
    return this.get(this.runtimeUrl(o, '/schema/entity-types'));
  }

  /** Get a single entity type by key. */
  getEntityType(key: string, options?: OntologyOverride): Promise<EntityType> {
    const o = this.resolveOntology(options);
    return this.get(this.runtimeUrl(o, `/schema/entity-types/${encodeURIComponent(key)}`));
  }

  /** List all relation types in the ontology. */
  getRelationTypes(options?: OntologyOverride): Promise<RelationType[]> {
    const o = this.resolveOntology(options);
    return this.get(this.runtimeUrl(o, '/schema/relation-types'));
  }

  /** Get a single relation type by key. */
  getRelationType(key: string, options?: OntologyOverride): Promise<RelationType> {
    const o = this.resolveOntology(options);
    return this.get(this.runtimeUrl(o, `/schema/relation-types/${encodeURIComponent(key)}`));
  }

  // -------------------------------------------------------------------------
  // Entity CRUD
  // -------------------------------------------------------------------------

  /** List entities of a type with optional filtering, search, sorting, and pagination. */
  listEntities(
    entityTypeKey: string,
    params?: ListEntityParams & OntologyOverride,
  ): Promise<PaginatedResponse<EntityInstance>> {
    const o = this.resolveOntology(params);
    const qs = buildQuery(
      {
        limit: params?.limit,
        offset: params?.offset,
        sort: params?.sort,
        order: params?.order,
        q: params?.q,
      },
      params?.filters,
      { fields: params?.fields },
    );
    return this.get(this.runtimeUrl(o, `/entities/${encodeURIComponent(entityTypeKey)}${qs}`));
  }

  /** Create a new entity instance. */
  createEntity(
    entityTypeKey: string,
    data: Record<string, unknown>,
    options?: OntologyOverride,
  ): Promise<EntityInstance> {
    const o = this.resolveOntology(options);
    return this.post(this.runtimeUrl(o, `/entities/${encodeURIComponent(entityTypeKey)}`), data);
  }

  /** Get a single entity by ID. */
  getEntity(
    entityTypeKey: string,
    id: string,
    params?: GetEntityParams & OntologyOverride,
  ): Promise<EntityInstance> {
    const o = this.resolveOntology(params);
    const qs = buildQuery({}, undefined, { fields: params?.fields });
    return this.get(
      this.runtimeUrl(o, `/entities/${encodeURIComponent(entityTypeKey)}/${encodeURIComponent(id)}${qs}`),
    );
  }

  /** Partially update an entity. Only provided properties are changed. */
  updateEntity(
    entityTypeKey: string,
    id: string,
    data: Record<string, unknown>,
    options?: OntologyOverride,
  ): Promise<EntityInstance> {
    const o = this.resolveOntology(options);
    return this.patch(
      this.runtimeUrl(o, `/entities/${encodeURIComponent(entityTypeKey)}/${encodeURIComponent(id)}`),
      data,
    );
  }

  /** Delete an entity and all its connected relations. */
  deleteEntity(
    entityTypeKey: string,
    id: string,
    options?: OntologyOverride,
  ): Promise<void> {
    const o = this.resolveOntology(options);
    return this.del(
      this.runtimeUrl(o, `/entities/${encodeURIComponent(entityTypeKey)}/${encodeURIComponent(id)}`),
    );
  }

  // -------------------------------------------------------------------------
  // Relation CRUD
  // -------------------------------------------------------------------------

  /** List relations of a type with optional filtering and pagination. */
  listRelations(
    relationTypeKey: string,
    params?: ListRelationParams & OntologyOverride,
  ): Promise<PaginatedResponse<RelationInstance>> {
    const o = this.resolveOntology(params);
    const qs = buildQuery(
      {
        limit: params?.limit,
        offset: params?.offset,
        sort: params?.sort,
        order: params?.order,
        fromEntityId: params?.fromEntityId,
        toEntityId: params?.toEntityId,
      },
      params?.filters,
    );
    return this.get(this.runtimeUrl(o, `/relations/${encodeURIComponent(relationTypeKey)}${qs}`));
  }

  /**
   * Create a new relation instance.
   *
   * `data` must include `fromEntityId` and `toEntityId`, plus any relation properties.
   */
  createRelation(
    relationTypeKey: string,
    data: { fromEntityId: string; toEntityId: string } & Record<string, unknown>,
    options?: OntologyOverride,
  ): Promise<RelationInstance> {
    const o = this.resolveOntology(options);
    return this.post(this.runtimeUrl(o, `/relations/${encodeURIComponent(relationTypeKey)}`), data);
  }

  /** Get a single relation by ID. */
  getRelation(
    relationTypeKey: string,
    id: string,
    options?: OntologyOverride,
  ): Promise<RelationInstance> {
    const o = this.resolveOntology(options);
    return this.get(
      this.runtimeUrl(o, `/relations/${encodeURIComponent(relationTypeKey)}/${encodeURIComponent(id)}`),
    );
  }

  /** Partially update a relation. Cannot change `fromEntityId` or `toEntityId`. */
  updateRelation(
    relationTypeKey: string,
    id: string,
    data: Record<string, unknown>,
    options?: OntologyOverride,
  ): Promise<RelationInstance> {
    const o = this.resolveOntology(options);
    return this.patch(
      this.runtimeUrl(o, `/relations/${encodeURIComponent(relationTypeKey)}/${encodeURIComponent(id)}`),
      data,
    );
  }

  /** Delete a relation. Connected entities are not affected. */
  deleteRelation(
    relationTypeKey: string,
    id: string,
    options?: OntologyOverride,
  ): Promise<void> {
    const o = this.resolveOntology(options);
    return this.del(
      this.runtimeUrl(o, `/relations/${encodeURIComponent(relationTypeKey)}/${encodeURIComponent(id)}`),
    );
  }

  // -------------------------------------------------------------------------
  // Graph traversal
  // -------------------------------------------------------------------------

  /** Get an entity's neighborhood — connected entities and relations. */
  getNeighbors(
    entityTypeKey: string,
    id: string,
    params?: NeighborParams & OntologyOverride,
  ): Promise<NeighborhoodResponse> {
    const o = this.resolveOntology(params);
    const qs = buildQuery(
      {
        relationTypeKey: params?.relationTypeKey,
        direction: params?.direction,
        limit: params?.limit,
      },
      undefined,
      { fields: params?.fields, relationFields: params?.relationFields },
    );
    return this.get(
      this.runtimeUrl(
        o,
        `/entities/${encodeURIComponent(entityTypeKey)}/${encodeURIComponent(id)}/neighbors${qs}`,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Semantic search
  // -------------------------------------------------------------------------

  /**
   * Search entities by natural language meaning using vector embeddings.
   *
   * Requires `EMBEDDING_PROVIDER` to be configured on the server.
   */
  semanticSearch(
    params: SemanticSearchParams & OntologyOverride,
  ): Promise<SemanticSearchResponse> {
    const o = this.resolveOntology(params);
    const qs = buildQuery(
      {
        q: params.q,
        type: params.type,
        limit: params.limit,
        min_score: params.minScore,
      },
      params.filters,
      { fields: params.fields },
    );
    return this.get(this.runtimeUrl(o, `/search/semantic${qs}`));
  }

  // -------------------------------------------------------------------------
  // Cypher query
  // -------------------------------------------------------------------------

  /**
   * Execute a read-only Cypher query against the ontology's scoped schema.
   *
   * Use schema entity type keys (snake_case) as node labels and relation type
   * keys as relationship types — the server translates them to Neo4j conventions
   * automatically.
   *
   * @example
   * ```ts
   * const result = await client.query(
   *   "MATCH (p:person)-[r:works_for]->(c:company) RETURN p, c LIMIT 10"
   * );
   * for (const row of result.results) {
   *   console.log(row.p, row.c);
   * }
   * ```
   */
  query(
    cypher: string,
    options?: OntologyOverride,
  ): Promise<CypherQueryResult> {
    const o = this.resolveOntology(options);
    return this.post(this.runtimeUrl(o, '/query'), { cypher });
  }
}
