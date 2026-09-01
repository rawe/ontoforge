/**
 * Runtime routes, mounted at
 * `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey`.
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
// `ontologyKey` binds the store, `lensKey` names the lens.
const LensParams = z.object({ ontologyKey: z.string(), lensKey: z.string() });
const TypeKeyParams = LensParams.extend({ key: z.string() });
const EntityTypeParams = LensParams.extend({ entityTypeKey: z.string() });
const EntityParams = EntityTypeParams.extend({ entityId: z.string() });

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

/** Boolean query parameter: accepts true/false, 1/0, yes/no, on/off in any
 * case. */
const BoolParam = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const lowered = value.toLowerCase();
  if (["true", "1", "yes", "on"].includes(lowered)) return true;
  if (["false", "0", "no", "off"].includes(lowered)) return false;
  return value;
}, z.boolean());

/** `GET /search/semantic` — bounds and defaults per `docs/interfaces.md`,
 * including the documented `min_score` snake_case irregularity. */
const SemanticSearchQuery = z.looseObject({
  q: z.string().min(1),
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  min_score: z.coerce.number().min(0).max(1).optional(),
  fields: FieldsParam,
  searchIn: z.enum(["entities", "documents", "all"]).default("all"),
  snippets: BoolParam.default(true),
});

/** Arbitrary property payloads: shape is decided by the schema at runtime,
 * so the only static rule is "a JSON object". */
const PropertyPayload = z.record(z.string(), z.unknown());

const DocumentParams = EntityParams.extend({ propertyKey: z.string() });

const DocumentReadQuery = z.looseObject({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).optional(),
});

/** One partial-write operation, discriminated by `op`, carrying both
 * operation shapes. Per-op field validation happens in the service. */
const DocumentEditPayload = z.looseObject({
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
});

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

/** Relation creation names its two endpoints; everything else in the body
 * is a property value. */
const RelationCreatePayload = z.looseObject({
  fromEntityId: z.string(),
  toEntityId: z.string(),
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

  app.get(
    "/schema",
    { schema: { tags: ["runtime"], params: LensParams } },
    async (request) =>
      service.getFullSchema(
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

  // --- Semantic search ---

  app.get(
    "/search/semantic",
    { schema: { tags: ["runtime"], params: LensParams, querystring: SemanticSearchQuery } },
    async (request) => {
      const { q, type, limit, min_score, fields, searchIn, snippets } = request.query;
      const filters = parseFilters(request.query as Record<string, unknown>);
      return service.semanticSearch(
        request.params.lensKey,
        q,
        type ?? null,
        limit,
        min_score ?? null,
        await getRuntimeStore(request.params.ontologyKey),
        { filters, fields: fields ?? null, searchIn, snippets },
      );
    },
  );

  // --- Entity instance CRUD ---

  app.post(
    "/entities/:entityTypeKey",
    { schema: { tags: ["runtime"], params: EntityTypeParams, body: PropertyPayload } },
    async (request, reply) => {
      const result = await service.createEntity(
        request.params.lensKey,
        request.params.entityTypeKey,
        request.body,
        await getRuntimeStore(request.params.ontologyKey),
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

  app.get(
    "/entities/:entityTypeKey/:entityId",
    { schema: { tags: ["runtime"], params: EntityParams, querystring: ReadQuery } },
    async (request) =>
      service.getEntity(
        request.params.lensKey,
        request.params.entityTypeKey,
        request.params.entityId,
        await getRuntimeStore(request.params.ontologyKey),
        request.query.fields ?? null,
      ),
  );

  app.patch(
    "/entities/:entityTypeKey/:entityId",
    { schema: { tags: ["runtime"], params: EntityParams, body: PropertyPayload } },
    async (request) =>
      service.updateEntity(
        request.params.lensKey,
        request.params.entityTypeKey,
        request.params.entityId,
        request.body,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.delete(
    "/entities/:entityTypeKey/:entityId",
    { schema: { tags: ["runtime"], params: EntityParams } },
    async (request, reply) => {
      await service.deleteEntity(
        request.params.lensKey,
        request.params.entityTypeKey,
        request.params.entityId,
        await getRuntimeStore(request.params.ontologyKey),
      );
      return reply.status(204).send();
    },
  );

  // --- Document properties ---

  app.get(
    "/entities/:entityTypeKey/:entityId/documents/:propertyKey",
    { schema: { tags: ["runtime"], params: DocumentParams, querystring: DocumentReadQuery } },
    async (request) =>
      service.getDocument(
        request.params.lensKey,
        request.params.entityTypeKey,
        request.params.entityId,
        request.params.propertyKey,
        request.query.offset,
        request.query.limit ?? null,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.patch(
    "/entities/:entityTypeKey/:entityId/documents/:propertyKey",
    { schema: { tags: ["runtime"], params: DocumentParams, body: DocumentEditPayload } },
    async (request) =>
      service.editDocument(
        request.params.lensKey,
        request.params.entityTypeKey,
        request.params.entityId,
        request.params.propertyKey,
        request.body,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  // --- Graph traversal ---

  app.get(
    "/entities/:entityTypeKey/:entityId/neighbors",
    { schema: { tags: ["runtime"], params: EntityParams, querystring: NeighborsQuery } },
    async (request) => {
      const { relationTypeKey, direction, limit, fields, relationFields } = request.query;
      return service.getNeighbors(
        request.params.lensKey,
        request.params.entityTypeKey,
        request.params.entityId,
        direction,
        relationTypeKey ?? null,
        limit,
        await getRuntimeStore(request.params.ontologyKey),
        fields ?? null,
        relationFields ?? null,
      );
    },
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
      const { fromEntityId, toEntityId, ...userProps } = request.body;
      const result = await service.createRelation(
        request.params.lensKey,
        request.params.relationTypeKey,
        fromEntityId,
        toEntityId,
        userProps,
        await getRuntimeStore(request.params.ontologyKey),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/relations/:relationTypeKey",
    { schema: { tags: ["runtime"], params: RelationTypeParams, querystring: RelationListQuery } },
    async (request) => {
      const { limit, offset, sort, order, fromEntityId, toEntityId } = request.query;
      const filters = parseFilters(request.query as Record<string, unknown>);
      return service.listRelations(
        request.params.lensKey,
        request.params.relationTypeKey,
        limit,
        offset,
        sort,
        order,
        fromEntityId ?? null,
        toEntityId ?? null,
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
      );
      return reply.status(204).send();
    },
  );
};
