/**
 * Runtime routes, mounted at `/api/runtime`.
 *
 * One lens-free route (`/features`), then everything else under
 * `/{ontologyKey}/...` — the runtime surface is addressed by KEYS
 * everywhere (`docs/interfaces.md`). Routers parse and shape only; every
 * domain rule lives in `service.ts`, shared with the runtime MCP server.
 *
 * Paging bounds are enforced here (limit 1–200, offset >= 0) so an
 * out-of-range value answers `422 VALIDATION_ERROR` — where the MCP tools
 * CLAMP instead of rejecting, a documented divergence-by-design between
 * the two entrances.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { settings } from "../config.js";
import { getRuntimeStore } from "../core/ports.js";
import { parseFilters } from "./service.js";
import * as service from "./service.js";

const FeaturesResponse = z.object({
  semanticSearch: z.boolean(),
  ai: z.boolean(),
});

/** Routes mounted at `/api/runtime` that take no ontology key. */
export const runtimeGlobalRouter: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/features",
    {
      schema: {
        tags: ["runtime"],
        response: { 200: FeaturesResponse },
      },
    },
    async () => ({
      semanticSearch: Boolean(settings.EMBEDDING_PROVIDER),
      ai: Boolean(settings.AI_PROVIDER),
    }),
  );
};

const OntologyParams = z.object({ ontologyKey: z.string() });
const TypeKeyParams = z.object({ ontologyKey: z.string(), key: z.string() });
const EntityTypeParams = z.object({ ontologyKey: z.string(), entityTypeKey: z.string() });
const EntityParams = z.object({
  ontologyKey: z.string(),
  entityTypeKey: z.string(),
  entityId: z.string(),
});

/** `fields` is repeated rather than comma-separated; one occurrence arrives
 * as a bare string and is normalized to a single-element list. */
const FieldsParam = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]));

// Unknown keys (the `filter.*` family) pass through untyped and are picked
// up by `parseFilters`; the declared parameters carry the Python router's
// exact bounds and defaults.
const ListQuery = z.looseObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.string().default("_createdAt"),
  order: z.enum(["asc", "desc"]).default("asc"),
  q: z.string().optional(),
  fields: FieldsParam,
});

const ReadQuery = z.looseObject({ fields: FieldsParam });

/** Arbitrary property payloads: shape is decided by the schema at runtime,
 * so the only static rule is "a JSON object". */
const PropertyPayload = z.record(z.string(), z.unknown());

const DocumentParams = z.object({
  ontologyKey: z.string(),
  entityTypeKey: z.string(),
  entityId: z.string(),
  propertyKey: z.string(),
});

const DocumentReadQuery = z.looseObject({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).optional(),
});

/** One partial-write operation, discriminated by `op` — the Python request
 * model's field names and both operation shapes (`runtime/schemas.py`).
 * Per-op field validation happens in the service. */
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

const RelationTypeParams = z.object({ ontologyKey: z.string(), relationTypeKey: z.string() });
const RelationParams = z.object({
  ontologyKey: z.string(),
  relationTypeKey: z.string(),
  relationId: z.string(),
});

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

/** Routes mounted at `/api/runtime` that address one lens by key. */
export const runtimeRouter: FastifyPluginAsyncZod = async (app) => {
  // --- Schema introspection (read-only, already filtered to the lens) ---

  app.get(
    "/:ontologyKey/schema",
    { schema: { tags: ["runtime"], params: OntologyParams } },
    async (request) => service.getFullSchema(request.params.ontologyKey, getRuntimeStore()),
  );

  app.get(
    "/:ontologyKey/schema/entity-types",
    { schema: { tags: ["runtime"], params: OntologyParams } },
    async (request) => service.listEntityTypes(request.params.ontologyKey, getRuntimeStore()),
  );

  app.get(
    "/:ontologyKey/schema/entity-types/:key",
    { schema: { tags: ["runtime"], params: TypeKeyParams } },
    async (request) =>
      service.getEntityType(request.params.ontologyKey, request.params.key, getRuntimeStore()),
  );

  app.get(
    "/:ontologyKey/schema/relation-types",
    { schema: { tags: ["runtime"], params: OntologyParams } },
    async (request) =>
      service.listRelationTypes(request.params.ontologyKey, getRuntimeStore()),
  );

  app.get(
    "/:ontologyKey/schema/relation-types/:key",
    { schema: { tags: ["runtime"], params: TypeKeyParams } },
    async (request) =>
      service.getRelationType(request.params.ontologyKey, request.params.key, getRuntimeStore()),
  );

  // --- Entity instance CRUD ---

  app.post(
    "/:ontologyKey/entities/:entityTypeKey",
    { schema: { tags: ["runtime"], params: EntityTypeParams, body: PropertyPayload } },
    async (request, reply) => {
      const result = await service.createEntity(
        request.params.ontologyKey,
        request.params.entityTypeKey,
        request.body,
        getRuntimeStore(),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/:ontologyKey/entities/:entityTypeKey",
    { schema: { tags: ["runtime"], params: EntityTypeParams, querystring: ListQuery } },
    async (request) => {
      const { limit, offset, sort, order, q, fields } = request.query;
      const filters = parseFilters(request.query as Record<string, unknown>);
      return service.listEntities(
        request.params.ontologyKey,
        request.params.entityTypeKey,
        limit,
        offset,
        sort,
        order,
        q ?? null,
        filters,
        getRuntimeStore(),
        fields ?? null,
      );
    },
  );

  app.get(
    "/:ontologyKey/entities/:entityTypeKey/:entityId",
    { schema: { tags: ["runtime"], params: EntityParams, querystring: ReadQuery } },
    async (request) =>
      service.getEntity(
        request.params.ontologyKey,
        request.params.entityTypeKey,
        request.params.entityId,
        getRuntimeStore(),
        request.query.fields ?? null,
      ),
  );

  app.patch(
    "/:ontologyKey/entities/:entityTypeKey/:entityId",
    { schema: { tags: ["runtime"], params: EntityParams, body: PropertyPayload } },
    async (request) =>
      service.updateEntity(
        request.params.ontologyKey,
        request.params.entityTypeKey,
        request.params.entityId,
        request.body,
        getRuntimeStore(),
      ),
  );

  app.delete(
    "/:ontologyKey/entities/:entityTypeKey/:entityId",
    { schema: { tags: ["runtime"], params: EntityParams } },
    async (request, reply) => {
      await service.deleteEntity(
        request.params.ontologyKey,
        request.params.entityTypeKey,
        request.params.entityId,
        getRuntimeStore(),
      );
      return reply.status(204).send();
    },
  );

  // --- Document properties ---

  app.get(
    "/:ontologyKey/entities/:entityTypeKey/:entityId/documents/:propertyKey",
    { schema: { tags: ["runtime"], params: DocumentParams, querystring: DocumentReadQuery } },
    async (request) =>
      service.getDocument(
        request.params.ontologyKey,
        request.params.entityTypeKey,
        request.params.entityId,
        request.params.propertyKey,
        request.query.offset,
        request.query.limit ?? null,
        getRuntimeStore(),
      ),
  );

  app.patch(
    "/:ontologyKey/entities/:entityTypeKey/:entityId/documents/:propertyKey",
    { schema: { tags: ["runtime"], params: DocumentParams, body: DocumentEditPayload } },
    async (request) =>
      service.editDocument(
        request.params.ontologyKey,
        request.params.entityTypeKey,
        request.params.entityId,
        request.params.propertyKey,
        request.body,
        getRuntimeStore(),
      ),
  );

  // --- Graph traversal ---

  app.get(
    "/:ontologyKey/entities/:entityTypeKey/:entityId/neighbors",
    { schema: { tags: ["runtime"], params: EntityParams, querystring: NeighborsQuery } },
    async (request) => {
      const { relationTypeKey, direction, limit, fields, relationFields } = request.query;
      return service.getNeighbors(
        request.params.ontologyKey,
        request.params.entityTypeKey,
        request.params.entityId,
        direction,
        relationTypeKey ?? null,
        limit,
        getRuntimeStore(),
        fields ?? null,
        relationFields ?? null,
      );
    },
  );

  // --- Relation instance CRUD ---

  app.post(
    "/:ontologyKey/relations/:relationTypeKey",
    {
      schema: { tags: ["runtime"], params: RelationTypeParams, body: RelationCreatePayload },
    },
    async (request, reply) => {
      const { fromEntityId, toEntityId, ...userProps } = request.body;
      const result = await service.createRelation(
        request.params.ontologyKey,
        request.params.relationTypeKey,
        fromEntityId,
        toEntityId,
        userProps,
        getRuntimeStore(),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/:ontologyKey/relations/:relationTypeKey",
    { schema: { tags: ["runtime"], params: RelationTypeParams, querystring: RelationListQuery } },
    async (request) => {
      const { limit, offset, sort, order, fromEntityId, toEntityId } = request.query;
      const filters = parseFilters(request.query as Record<string, unknown>);
      return service.listRelations(
        request.params.ontologyKey,
        request.params.relationTypeKey,
        limit,
        offset,
        sort,
        order,
        fromEntityId ?? null,
        toEntityId ?? null,
        filters,
        getRuntimeStore(),
      );
    },
  );

  app.get(
    "/:ontologyKey/relations/:relationTypeKey/:relationId",
    { schema: { tags: ["runtime"], params: RelationParams } },
    async (request) =>
      service.getRelation(
        request.params.ontologyKey,
        request.params.relationTypeKey,
        request.params.relationId,
        getRuntimeStore(),
      ),
  );

  app.patch(
    "/:ontologyKey/relations/:relationTypeKey/:relationId",
    { schema: { tags: ["runtime"], params: RelationParams, body: PropertyPayload } },
    async (request) =>
      service.updateRelation(
        request.params.ontologyKey,
        request.params.relationTypeKey,
        request.params.relationId,
        request.body,
        getRuntimeStore(),
      ),
  );

  app.delete(
    "/:ontologyKey/relations/:relationTypeKey/:relationId",
    { schema: { tags: ["runtime"], params: RelationParams } },
    async (request, reply) => {
      await service.deleteRelation(
        request.params.ontologyKey,
        request.params.relationTypeKey,
        request.params.relationId,
        getRuntimeStore(),
      );
      return reply.status(204).send();
    },
  );
};
