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
};
