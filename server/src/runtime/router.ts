/**
 * Runtime routes, mounted at
 * `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey`.
 *
 * The ruleset mirror mounts the same routes below
 * `…/lenses/:lensKey/rulesets/:rulesetKey` (`rulesetRouter.ts`).
 *
 * Every request names its ontology and lens in the path and runs against
 * a runtime store bound to that ontology — an unknown ontology key
 * answers 404 before any route logic runs. Below the lens the surface is
 * addressed by KEYS everywhere (`docs/interfaces.md`). Routers parse and
 * shape only; every domain rule lives in `service.ts`, shared with the
 * runtime MCP server.
 *
 * Paging bounds are enforced here (limit 1–200, offset >= 0) so an
 * out-of-range value answers `422 VALIDATION_ERROR` — where the MCP tools
 * CLAMP instead of rejecting, a documented divergence-by-design between
 * the two entrances.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getRuntimeStore } from "../core/ports.js";
import { parseFilters } from "./service.js";
import * as service from "./service.js";

// Every params schema carries the mount prefix's own parameters —
// `ontologyKey` binds the store, `lensKey` names the lens. The ruleset
// mirror (`rulesetRouter.ts`) extends each with its `rulesetKey`.
export const LensParams = z.object({ ontologyKey: z.string(), lensKey: z.string() });

/** The ruleset key on the ruleset mirror; null on the plain lens. */
export function rulesetOf(params: object): string | null {
  return "rulesetKey" in params && typeof params.rulesetKey === "string" ? params.rulesetKey : null;
}
const TypeKeyParams = LensParams.extend({ key: z.string() });
const EntityTypeParams = LensParams.extend({ entityTypeKey: z.string() });
const EntityParams = EntityTypeParams.extend({ entityId: z.string() });
/** An entity by identity: one URL-encoded path segment, decoded once. */
const IdentityParams = EntityTypeParams.extend({ identity: z.string() });

/** `fields` is repeated rather than comma-separated; one occurrence arrives
 * as a bare string and is normalized to a single-element list. */
const FieldsParam = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]));

// Unknown keys (the `filter.*` family) pass through untyped and are picked
// up by `parseFilters`; the declared parameters carry the bounds and
// defaults documented in `docs/interfaces.md`.
const ListQuery = z.looseObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.string().default("_createdAt"),
  order: z.enum(["asc", "desc"]).default("asc"),
  q: z.string().optional(),
  fields: FieldsParam,
});

const ReadQuery = z.looseObject({ fields: FieldsParam });

const SearchQuery = z.looseObject({
  q: z.string(),
  type: z.string().optional(),
  limit: z.coerce.number().default(10),
  fields: FieldsParam,
  in: z.union([z.string(), z.array(z.string())]).optional(),
  strategy: z.string().optional(),
  min_similarity: z.coerce.number().optional(),
  "document.property": z.union([z.string(), z.array(z.string())]).optional(),
});

/** `POST /search` — the index search. Only the shape is checked here;
 * bounds, keys and modes are domain rules (`searchByIndices`), reported
 * by field. `filters` carries the `filter.*` keys of `GET /search`
 * without the prefix. */
const IndexSearchPayload = z.strictObject({
  indices: z.array(z.string()).optional(),
  query: z.string(),
  mode: z.string().optional(),
  relations: z.array(z.string()).optional(),
  filters: z.record(z.string(), z.string()).optional(),
  minScore: z.number().optional(),
  limit: z.number().optional(),
  fields: z.array(z.string()).optional(),
});

/** Arbitrary property payloads: shape is decided by the schema at runtime,
 * so the only static rule is "a JSON object". */
export const PropertyPayload = z.record(z.string(), z.unknown());

/** The parent relation an entity is created under. */
export const ParentRelationPayload = z.object({
  type: z.string(),
  /** Exactly one of the two names the parent; the service checks it. */
  parentId: z.string().optional(),
  parentIdentity: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

/** An entity create: the flat property map, plus the optional parent
 * relation the entity is created under. Property keys are lower snake
 * case, so `parentRelation` cannot collide with one. */
const EntityCreatePayload = z.looseObject({
  parentRelation: ParentRelationPayload.optional(),
});

const DocumentParams = EntityParams.extend({ propertyKey: z.string() });
const IdentityDocumentParams = IdentityParams.extend({ propertyKey: z.string() });

export const DocumentReadQuery = z.looseObject({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).optional(),
});

/** The fields of one partial-write operation, discriminated by `op`,
 * carrying both operation shapes. Per-op field validation happens in the
 * service. */
export const DocumentEditFields = {
  op: z.enum(["str_replace", "replace_range"]),
  // str_replace
  oldString: z.string().nullish(),
  newString: z.string().nullish(),
  replaceAll: z.boolean().default(false),
  // replace_range
  offset: z.number().int().nullish(),
  length: z.number().int().nullish(),
  content: z.string().nullish(),
  expect: z.string().nullish(),
};

const DocumentEditPayload = z.looseObject(DocumentEditFields);

/** OQL query request: the query text, nothing else (`docs/interfaces.md`). */
const QueryPayload = z.looseObject({ query: z.string().min(1) });

const SavedQueryRunParams = LensParams.extend({ queryKey: z.string() });

/** Saved-query run request: parameter values keyed by name. */
const SavedQueryRunPayload = z.looseObject({
  params: z.record(z.string(), z.unknown()).default({}),
});

/** `GET /saved-queries/search` — bounds and defaults per
 * `docs/interfaces.md`, including the `min_score` snake_case irregularity. */
const SavedQuerySearchQuery = z.looseObject({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(3),
  min_score: z.coerce.number().min(0).max(1).default(0.7),
});

const RelationTypeParams = LensParams.extend({ relationTypeKey: z.string() });
const RelationParams = RelationTypeParams.extend({ relationId: z.string() });

/** Relation creation names its two endpoints, each by id or by identity
 * (exactly one, checked by the service); everything else in the body is a
 * property value. */
const RelationCreatePayload = z.looseObject({
  fromEntityId: z.string().optional(),
  toEntityId: z.string().optional(),
  fromEntityIdentity: z.string().optional(),
  toEntityIdentity: z.string().optional(),
});

/** Relation lists take NO free-text `q` and NO `fields` projection — only
 * paging, sorting, the `filter.*` family, and the endpoint filters that
 * are the one way to count/page one entity's relations. */
const RelationListQuery = z.looseObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.string().default("_createdAt"),
  order: z.enum(["asc", "desc"]).default("asc"),
  fromEntityId: z.string().optional(),
  toEntityId: z.string().optional(),
  fromEntityIdentity: z.string().optional(),
  toEntityIdentity: z.string().optional(),
});

const NeighborsQuery = z.looseObject({
  relationTypeKey: z.string().optional(),
  direction: z.enum(["outgoing", "incoming", "both"]).default("both"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  fields: FieldsParam,
  relationFields: FieldsParam,
});

/** Routes mounted at `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey`. */
export const runtimeRouter: FastifyPluginAsyncZod = async (app) => {
  // --- Schema introspection (read-only, already filtered to the lens) ---

  app.get("/schema", { schema: { tags: ["runtime"], params: LensParams } }, async (request) =>
    service.getLensSchema(
      request.params.lensKey,
      await getRuntimeStore(request.params.ontologyKey),
    ),
  );

  app.get(
    "/schema/entity-types",
    { schema: { tags: ["runtime"], params: LensParams } },
    async (request) =>
      service.listEntityTypes(
        request.params.lensKey,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.get(
    "/schema/entity-types/:key",
    { schema: { tags: ["runtime"], params: TypeKeyParams } },
    async (request) =>
      service.getEntityType(
        request.params.lensKey,
        request.params.key,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.get(
    "/schema/relation-types",
    { schema: { tags: ["runtime"], params: LensParams } },
    async (request) =>
      service.listRelationTypes(
        request.params.lensKey,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.get(
    "/schema/relation-types/:key",
    { schema: { tags: ["runtime"], params: TypeKeyParams } },
    async (request) =>
      service.getRelationType(
        request.params.lensKey,
        request.params.key,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.get(
    "/search",
    { schema: { tags: ["runtime"], params: LensParams, querystring: SearchQuery } },
    async (request) => {
      const q = request.query;
      return service.search(
        request.params.lensKey,
        {
          query: q.q,
          type: q.type ?? null,
          limit: q.limit,
          fields: q.fields ?? null,
          in: (q.in === undefined ? null : Array.isArray(q.in) ? q.in : [q.in]) as
            | import("./search/request.js").SearchKind[]
            | null,
          strategy: (q.strategy ?? null) as import("./search/strategies.js").SearchStrategy | null,
          minSimilarity: q.min_similarity ?? null,
          filter: parseFilters(q),
          document: { property: q["document.property"] as string | undefined },
        },
        await getRuntimeStore(request.params.ontologyKey),
      );
    },
  );

  app.get(
    "/search-indices",
    { schema: { tags: ["runtime"], params: LensParams } },
    async (request) =>
      service.searchIndexCatalog(
        request.params.lensKey,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.post(
    "/search",
    { schema: { tags: ["runtime"], params: LensParams, body: IndexSearchPayload } },
    async (request) => {
      const body = request.body;
      return service.searchByIndices(
        request.params.lensKey,
        { ...body, mode: body.mode as import("./search/indexSearch.js").SearchMode | undefined },
        await getRuntimeStore(request.params.ontologyKey),
      );
    },
  );

  // --- Entity instance CRUD ---

  app.post(
    "/entities/:entityTypeKey",
    { schema: { tags: ["runtime"], params: EntityTypeParams, body: EntityCreatePayload } },
    async (request, reply) => {
      const { parentRelation, ...properties } = request.body;
      const result = await service.createEntity(
        request.params.lensKey,
        request.params.entityTypeKey,
        properties,
        await getRuntimeStore(request.params.ontologyKey),
        parentRelation ?? null,
        rulesetOf(request.params),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/entities/:entityTypeKey",
    { schema: { tags: ["runtime"], params: EntityTypeParams, querystring: ListQuery } },
    async (request) => {
      const { limit, offset, sort, order, q, fields } = request.query;
      const filters = parseFilters(request.query as Record<string, unknown>);
      return service.listEntities(
        request.params.lensKey,
        request.params.entityTypeKey,
        limit,
        offset,
        sort,
        order,
        q ?? null,
        filters,
        await getRuntimeStore(request.params.ontologyKey),
        fields ?? null,
      );
    },
  );

  // --- One entity, by id and by identity ---
  //
  // Every route that names an entity by id has an identity twin below
  // `/entities/:entityTypeKey/identity/:identity`: the identity is resolved
  // to the id through the lens first (`resolveEntityIdentity`), then the
  // route runs as by id. Ids are UUIDs, so the static `identity` segment
  // never shadows one.

  /** Register one entity route twice: by id, and by identity. The handler
   * reads the entity's id through `entityIdOf` only; the identity route's
   * params schema (`byIdentity`) carries `identity` in place of `entityId`. */
  const twin = <Params extends z.ZodObject>(
    register: (path: string, params: Params, entityIdOf: (params: object) => Promise<string>) => void,
    suffix: string,
    byId: Params,
    byIdentity: z.ZodObject,
  ): void => {
    register(`/entities/:entityTypeKey/:entityId${suffix}`, byId, async (params) => (params as { entityId: string }).entityId);
    register(`/entities/:entityTypeKey/identity/:identity${suffix}`, byIdentity as Params, async (params) => {
      const { ontologyKey, lensKey, entityTypeKey, identity } = params as z.infer<typeof IdentityParams>;
      return service.resolveEntityIdentity(lensKey, entityTypeKey, identity, await getRuntimeStore(ontologyKey));
    });
  };

  twin(
    (path, params, entityIdOf) =>
      app.get(path, { schema: { tags: ["runtime"], params, querystring: ReadQuery } }, async (request) =>
        service.getEntity(
          request.params.lensKey,
          request.params.entityTypeKey,
          await entityIdOf(request.params),
          await getRuntimeStore(request.params.ontologyKey),
          request.query.fields ?? null,
        ),
      ),
    "",
    EntityParams,
    IdentityParams,
  );

  twin(
    (path, params, entityIdOf) =>
      app.patch(path, { schema: { tags: ["runtime"], params, body: PropertyPayload } }, async (request) =>
        service.updateEntity(
          request.params.lensKey,
          request.params.entityTypeKey,
          await entityIdOf(request.params),
          request.body,
          await getRuntimeStore(request.params.ontologyKey),
          rulesetOf(request.params),
        ),
      ),
    "",
    EntityParams,
    IdentityParams,
  );

  twin(
    (path, params, entityIdOf) =>
      app.delete(path, { schema: { tags: ["runtime"], params } }, async (request, reply) => {
        await service.deleteEntity(
          request.params.lensKey,
          request.params.entityTypeKey,
          await entityIdOf(request.params),
          await getRuntimeStore(request.params.ontologyKey),
          rulesetOf(request.params),
        );
        return reply.status(204).send();
      }),
    "",
    EntityParams,
    IdentityParams,
  );

  twin(
    (path, params, entityIdOf) =>
      app.get(path, { schema: { tags: ["runtime"], params } }, async (request) =>
        service.getPath(
          request.params.lensKey,
          request.params.entityTypeKey,
          await entityIdOf(request.params),
          await getRuntimeStore(request.params.ontologyKey),
        ),
      ),
    "/path",
    EntityParams,
    IdentityParams,
  );

  // --- Document properties ---

  twin(
    (path, params, entityIdOf) =>
      app.get(path, { schema: { tags: ["runtime"], params, querystring: DocumentReadQuery } }, async (request) =>
        service.getDocument(
          request.params.lensKey,
          request.params.entityTypeKey,
          await entityIdOf(request.params),
          request.params.propertyKey,
          request.query.offset,
          request.query.limit ?? null,
          await getRuntimeStore(request.params.ontologyKey),
        ),
      ),
    "/documents/:propertyKey",
    DocumentParams,
    IdentityDocumentParams,
  );

  twin(
    (path, params, entityIdOf) =>
      app.patch(path, { schema: { tags: ["runtime"], params, body: DocumentEditPayload } }, async (request) =>
        service.editDocument(
          request.params.lensKey,
          request.params.entityTypeKey,
          await entityIdOf(request.params),
          request.params.propertyKey,
          request.body,
          await getRuntimeStore(request.params.ontologyKey),
          rulesetOf(request.params),
        ),
      ),
    "/documents/:propertyKey",
    DocumentParams,
    IdentityDocumentParams,
  );

  // --- Graph traversal ---

  twin(
    (path, params, entityIdOf) =>
      app.get(path, { schema: { tags: ["runtime"], params, querystring: NeighborsQuery } }, async (request) => {
        const { relationTypeKey, direction, limit, fields, relationFields } = request.query;
        return service.getNeighbors(
          request.params.lensKey,
          request.params.entityTypeKey,
          await entityIdOf(request.params),
          direction,
          relationTypeKey ?? null,
          limit,
          await getRuntimeStore(request.params.ontologyKey),
          fields ?? null,
          relationFields ?? null,
        );
      }),
    "/neighbors",
    EntityParams,
    IdentityParams,
  );

  // --- OQL query ---

  app.post(
    "/query",
    { schema: { tags: ["runtime"], params: LensParams, body: QueryPayload } },
    async (request) =>
      service.executeQuery(
        request.params.lensKey,
        request.body.query,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  // --- Saved queries (runtime: list from the cache, search, run) ---

  app.get(
    "/saved-queries",
    { schema: { tags: ["runtime"], params: LensParams } },
    async (request) =>
      service.listSavedQueries(
        request.params.lensKey,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.get(
    "/saved-queries/search",
    { schema: { tags: ["runtime"], params: LensParams, querystring: SavedQuerySearchQuery } },
    async (request) =>
      service.searchSavedQueries(
        request.params.lensKey,
        request.query.q,
        request.query.limit,
        request.query.min_score,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.post(
    "/saved-queries/:queryKey/run",
    { schema: { tags: ["runtime"], params: SavedQueryRunParams, body: SavedQueryRunPayload } },
    async (request) =>
      service.executeSavedQuery(
        request.params.lensKey,
        request.params.queryKey,
        request.body.params,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  // --- Relation instance CRUD ---

  app.post(
    "/relations/:relationTypeKey",
    {
      schema: { tags: ["runtime"], params: RelationTypeParams, body: RelationCreatePayload },
    },
    async (request, reply) => {
      const { fromEntityId, toEntityId, fromEntityIdentity, toEntityIdentity, ...userProps } = request.body;
      const result = await service.createRelation(
        request.params.lensKey,
        request.params.relationTypeKey,
        { fromEntityId, toEntityId, fromEntityIdentity, toEntityIdentity },
        userProps,
        await getRuntimeStore(request.params.ontologyKey),
        rulesetOf(request.params),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/relations/:relationTypeKey",
    { schema: { tags: ["runtime"], params: RelationTypeParams, querystring: RelationListQuery } },
    async (request) => {
      const { limit, offset, sort, order, fromEntityId, toEntityId, fromEntityIdentity, toEntityIdentity } =
        request.query;
      const filters = parseFilters(request.query as Record<string, unknown>);
      return service.listRelations(
        request.params.lensKey,
        request.params.relationTypeKey,
        limit,
        offset,
        sort,
        order,
        { fromEntityId, toEntityId, fromEntityIdentity, toEntityIdentity },
        filters,
        await getRuntimeStore(request.params.ontologyKey),
      );
    },
  );

  app.get(
    "/relations/:relationTypeKey/:relationId",
    { schema: { tags: ["runtime"], params: RelationParams } },
    async (request) =>
      service.getRelation(
        request.params.lensKey,
        request.params.relationTypeKey,
        request.params.relationId,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.patch(
    "/relations/:relationTypeKey/:relationId",
    { schema: { tags: ["runtime"], params: RelationParams, body: PropertyPayload } },
    async (request) =>
      service.updateRelation(
        request.params.lensKey,
        request.params.relationTypeKey,
        request.params.relationId,
        request.body,
        await getRuntimeStore(request.params.ontologyKey),
        rulesetOf(request.params),
      ),
  );

  app.delete(
    "/relations/:relationTypeKey/:relationId",
    { schema: { tags: ["runtime"], params: RelationParams } },
    async (request, reply) => {
      await service.deleteRelation(
        request.params.lensKey,
        request.params.relationTypeKey,
        request.params.relationId,
        await getRuntimeStore(request.params.ontologyKey),
        rulesetOf(request.params),
      );
      return reply.status(204).send();
    },
  );
};
