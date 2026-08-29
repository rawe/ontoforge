/**
 * Modeling REST routes, mounted at `/api/model`.
 *
 * This surface is global and addresses types and properties by INTERNAL
 * IDENTIFIER, not key (`docs/interfaces.md`, "What a path segment
 * identifies"). Routers parse and shape only — every domain rule lives in
 * `service.ts`, shared with the modeling MCP server.
 */

import { Readable } from "node:stream";

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getEmbeddingProvider } from "../core/embedding.js";
import { ValidationError } from "../core/exceptions.js";
import { getModelingStore, getRuntimeStore } from "../core/ports.js";
import {
  AiAgentConfigResponse,
  AiAgentConfigUpsert,
  EntityTypeCreate,
  EntityTypeResponse,
  EntityTypeUpdate,
  ExportPayload,
  IncludeTypeRequest,
  IncludeTypeResponse,
  IncludeTypeUpdate,
  LensCreate,
  LensResponse,
  LensUpdate,
  PropertyDefinitionCreate,
  PropertyDefinitionResponse,
  PropertyDefinitionUpdate,
  RelationTypeCreate,
  RelationTypeResponse,
  RelationTypeUpdate,
  SavedQueryResponse,
  SavedQueryUpsert,
  ValidationResult,
} from "./schemas.js";
import * as service from "./service.js";

const LensIdParams = z.object({ lensId: z.string() });
const LensTypeParams = z.object({ lensId: z.string(), typeId: z.string() });
const EntityTypeIdParams = z.object({ entityTypeId: z.string() });
const RelationTypeIdParams = z.object({ relationTypeId: z.string() });
const EntityTypePropertyParams = z.object({
  entityTypeId: z.string(),
  propertyId: z.string(),
});
const RelationTypePropertyParams = z.object({
  relationTypeId: z.string(),
  propertyId: z.string(),
});

// Agent configs and saved queries are the modeling exceptions addressed by
// KEY, not internal identifier (`docs/interfaces.md`).
const LensKeyParams = z.object({ lensKey: z.string() });
const AgentKeyParams = z.object({ lensKey: z.string(), agentKey: z.string() });
const QueryKeyParams = z.object({ lensKey: z.string(), queryKey: z.string() });

// `cascade` arrives as a query-string token; accept the usual boolean
// spellings clients send.
const CascadeQuery = z.object({
  cascade: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((value) => value === "true" || value === "1"),
});

/** Routes mounted at `/api/model`. */
export const modelingRouter: FastifyPluginAsyncZod = async (app) => {
  // --- Lenses ---

  app.post(
    "/lenses",
    {
      schema: {
        tags: ["modeling"],
        body: LensCreate,
        response: { 201: LensResponse },
      },
    },
    async (request, reply) => {
      const result = await service.createLens(request.body, getModelingStore());
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/lenses",
    {
      schema: {
        tags: ["modeling"],
        response: { 200: z.array(LensResponse) },
      },
    },
    async () => service.listLenses(getModelingStore()),
  );

  app.get(
    "/lenses/:lensId",
    {
      schema: {
        tags: ["modeling"],
        params: LensIdParams,
        response: { 200: LensResponse },
      },
    },
    async (request) => service.getLens(request.params.lensId, getModelingStore()),
  );

  app.put(
    "/lenses/:lensId",
    {
      schema: {
        tags: ["modeling"],
        params: LensIdParams,
        body: LensUpdate,
        response: { 200: LensResponse },
      },
    },
    async (request) =>
      service.updateLens(request.params.lensId, request.body, getModelingStore()),
  );

  app.delete(
    "/lenses/:lensId",
    {
      schema: {
        tags: ["modeling"],
        params: LensIdParams,
      },
    },
    async (request, reply) => {
      await service.deleteLens(request.params.lensId, getModelingStore());
      return reply.status(204).send();
    },
  );

  // --- Scope Management ---
  // Adding an inclusion names the type by KEY in the body; updating or
  // removing one names it by INTERNAL IDENTIFIER in the path.

  app.post(
    "/lenses/:lensId/includes/entity-types",
    {
      schema: {
        tags: ["modeling"],
        params: LensIdParams,
        body: IncludeTypeRequest,
        response: { 201: IncludeTypeResponse },
      },
    },
    async (request, reply) => {
      const result = await service.addIncludesEntityType(
        request.params.lensId,
        request.body,
        getModelingStore(),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/lenses/:lensId/includes/entity-types",
    {
      schema: {
        tags: ["modeling"],
        params: LensIdParams,
        response: { 200: z.array(IncludeTypeResponse) },
      },
    },
    async (request) =>
      service.listIncludesEntityTypes(request.params.lensId, getModelingStore()),
  );

  app.put(
    "/lenses/:lensId/includes/entity-types/:typeId",
    {
      schema: {
        tags: ["modeling"],
        params: LensTypeParams,
        body: IncludeTypeUpdate,
        response: { 200: IncludeTypeResponse },
      },
    },
    async (request) =>
      service.updateIncludesEntityType(
        request.params.lensId,
        request.params.typeId,
        request.body,
        getModelingStore(),
      ),
  );

  app.delete(
    "/lenses/:lensId/includes/entity-types/:typeId",
    {
      schema: {
        tags: ["modeling"],
        params: LensTypeParams,
      },
    },
    async (request, reply) => {
      await service.removeIncludesEntityType(
        request.params.lensId,
        request.params.typeId,
        getModelingStore(),
      );
      return reply.status(204).send();
    },
  );

  app.post(
    "/lenses/:lensId/includes/relation-types",
    {
      schema: {
        tags: ["modeling"],
        params: LensIdParams,
        body: IncludeTypeRequest,
        response: { 201: IncludeTypeResponse },
      },
    },
    async (request, reply) => {
      const result = await service.addIncludesRelationType(
        request.params.lensId,
        request.body,
        getModelingStore(),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/lenses/:lensId/includes/relation-types",
    {
      schema: {
        tags: ["modeling"],
        params: LensIdParams,
        response: { 200: z.array(IncludeTypeResponse) },
      },
    },
    async (request) =>
      service.listIncludesRelationTypes(request.params.lensId, getModelingStore()),
  );

  app.put(
    "/lenses/:lensId/includes/relation-types/:typeId",
    {
      schema: {
        tags: ["modeling"],
        params: LensTypeParams,
        body: IncludeTypeUpdate,
        response: { 200: IncludeTypeResponse },
      },
    },
    async (request) =>
      service.updateIncludesRelationType(
        request.params.lensId,
        request.params.typeId,
        request.body,
        getModelingStore(),
      ),
  );

  app.delete(
    "/lenses/:lensId/includes/relation-types/:typeId",
    {
      schema: {
        tags: ["modeling"],
        params: LensTypeParams,
      },
    },
    async (request, reply) => {
      await service.removeIncludesRelationType(
        request.params.lensId,
        request.params.typeId,
        getModelingStore(),
      );
      return reply.status(204).send();
    },
  );

  // --- Validation ---
  // Both operations always answer 200 with {valid, errors[]} — they
  // report, they never raise.

  app.post(
    "/lenses/:lensId/validate",
    {
      schema: {
        tags: ["modeling"],
        params: LensIdParams,
        response: { 200: ValidationResult },
      },
    },
    async (request) => service.validateLens(request.params.lensId, getModelingStore()),
  );

  app.post(
    "/schema/validate",
    {
      schema: {
        tags: ["modeling"],
        response: { 200: ValidationResult },
      },
    },
    async () => service.validateAll(getModelingStore()),
  );

  // --- Export / Import (transfer format) ---

  app.get(
    "/export",
    { schema: { tags: ["modeling"] } },
    async () => service.getSchemaExport(getModelingStore()),
  );

  app.post(
    "/import",
    {
      schema: {
        tags: ["modeling"],
        body: ExportPayload,
      },
    },
    async (request, reply) => {
      const result = await service.importSchema(request.body, getModelingStore());
      return reply.status(201).send(result);
    },
  );

  // --- Entity Types (Global) ---

  app.post(
    "/entity-types",
    {
      schema: {
        tags: ["modeling"],
        body: EntityTypeCreate,
        response: { 201: EntityTypeResponse },
      },
    },
    async (request, reply) => {
      const result = await service.createEntityType(request.body, getModelingStore());
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/entity-types",
    {
      schema: {
        tags: ["modeling"],
        response: { 200: z.array(EntityTypeResponse) },
      },
    },
    async () => service.listEntityTypes(getModelingStore()),
  );

  app.get(
    "/entity-types/:entityTypeId",
    {
      schema: {
        tags: ["modeling"],
        params: EntityTypeIdParams,
        response: { 200: EntityTypeResponse },
      },
    },
    async (request) => service.getEntityType(request.params.entityTypeId, getModelingStore()),
  );

  app.put(
    "/entity-types/:entityTypeId",
    {
      schema: {
        tags: ["modeling"],
        params: EntityTypeIdParams,
        body: EntityTypeUpdate,
        response: { 200: EntityTypeResponse },
      },
    },
    async (request) =>
      service.updateEntityType(request.params.entityTypeId, request.body, getModelingStore()),
  );

  app.delete(
    "/entity-types/:entityTypeId",
    {
      schema: {
        tags: ["modeling"],
        params: EntityTypeIdParams,
        querystring: CascadeQuery,
      },
    },
    async (request, reply) => {
      await service.deleteEntityType(
        request.params.entityTypeId,
        request.query.cascade,
        getModelingStore(),
      );
      return reply.status(204).send();
    },
  );

  // --- Relation Types (Global) ---

  app.post(
    "/relation-types",
    {
      schema: {
        tags: ["modeling"],
        body: RelationTypeCreate,
        response: { 201: RelationTypeResponse },
      },
    },
    async (request, reply) => {
      const result = await service.createRelationType(request.body, getModelingStore());
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/relation-types",
    {
      schema: {
        tags: ["modeling"],
        response: { 200: z.array(RelationTypeResponse) },
      },
    },
    async () => service.listRelationTypes(getModelingStore()),
  );

  app.get(
    "/relation-types/:relationTypeId",
    {
      schema: {
        tags: ["modeling"],
        params: RelationTypeIdParams,
        response: { 200: RelationTypeResponse },
      },
    },
    async (request) =>
      service.getRelationType(request.params.relationTypeId, getModelingStore()),
  );

  app.put(
    "/relation-types/:relationTypeId",
    {
      schema: {
        tags: ["modeling"],
        params: RelationTypeIdParams,
        body: RelationTypeUpdate,
        response: { 200: RelationTypeResponse },
      },
    },
    async (request) =>
      service.updateRelationType(
        request.params.relationTypeId,
        request.body,
        getModelingStore(),
      ),
  );

  app.delete(
    "/relation-types/:relationTypeId",
    {
      schema: {
        tags: ["modeling"],
        params: RelationTypeIdParams,
        querystring: CascadeQuery,
      },
    },
    async (request, reply) => {
      await service.deleteRelationType(
        request.params.relationTypeId,
        request.query.cascade,
        getModelingStore(),
      );
      return reply.status(204).send();
    },
  );

  // --- Entity Type Properties ---

  app.post(
    "/entity-types/:entityTypeId/properties",
    {
      schema: {
        tags: ["modeling"],
        params: EntityTypeIdParams,
        querystring: CascadeQuery,
        body: PropertyDefinitionCreate,
        response: { 201: PropertyDefinitionResponse },
      },
    },
    async (request, reply) => {
      const result = await service.createProperty(
        request.params.entityTypeId,
        "EntityType",
        request.body,
        request.query.cascade,
        getModelingStore(),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/entity-types/:entityTypeId/properties",
    {
      schema: {
        tags: ["modeling"],
        params: EntityTypeIdParams,
        response: { 200: z.array(PropertyDefinitionResponse) },
      },
    },
    async (request) =>
      service.listProperties(request.params.entityTypeId, "EntityType", getModelingStore()),
  );

  app.put(
    "/entity-types/:entityTypeId/properties/:propertyId",
    {
      schema: {
        tags: ["modeling"],
        params: EntityTypePropertyParams,
        body: PropertyDefinitionUpdate,
        response: { 200: PropertyDefinitionResponse },
      },
    },
    async (request) =>
      service.updateProperty(
        request.params.entityTypeId,
        "EntityType",
        request.params.propertyId,
        request.body,
        getModelingStore(),
      ),
  );

  app.delete(
    "/entity-types/:entityTypeId/properties/:propertyId",
    {
      schema: {
        tags: ["modeling"],
        params: EntityTypePropertyParams,
        querystring: CascadeQuery,
      },
    },
    async (request, reply) => {
      await service.deleteProperty(
        request.params.entityTypeId,
        "EntityType",
        request.params.propertyId,
        request.query.cascade,
        getModelingStore(),
      );
      return reply.status(204).send();
    },
  );

  // --- Relation Type Properties ---

  app.post(
    "/relation-types/:relationTypeId/properties",
    {
      schema: {
        tags: ["modeling"],
        params: RelationTypeIdParams,
        querystring: CascadeQuery,
        body: PropertyDefinitionCreate,
        response: { 201: PropertyDefinitionResponse },
      },
    },
    async (request, reply) => {
      const result = await service.createProperty(
        request.params.relationTypeId,
        "RelationType",
        request.body,
        request.query.cascade,
        getModelingStore(),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/relation-types/:relationTypeId/properties",
    {
      schema: {
        tags: ["modeling"],
        params: RelationTypeIdParams,
        response: { 200: z.array(PropertyDefinitionResponse) },
      },
    },
    async (request) =>
      service.listProperties(
        request.params.relationTypeId,
        "RelationType",
        getModelingStore(),
      ),
  );

  app.put(
    "/relation-types/:relationTypeId/properties/:propertyId",
    {
      schema: {
        tags: ["modeling"],
        params: RelationTypePropertyParams,
        body: PropertyDefinitionUpdate,
        response: { 200: PropertyDefinitionResponse },
      },
    },
    async (request) =>
      service.updateProperty(
        request.params.relationTypeId,
        "RelationType",
        request.params.propertyId,
        request.body,
        getModelingStore(),
      ),
  );

  app.delete(
    "/relation-types/:relationTypeId/properties/:propertyId",
    {
      schema: {
        tags: ["modeling"],
        params: RelationTypePropertyParams,
        querystring: CascadeQuery,
      },
    },
    async (request, reply) => {
      await service.deleteProperty(
        request.params.relationTypeId,
        "RelationType",
        request.params.propertyId,
        request.query.cascade,
        getModelingStore(),
      );
      return reply.status(204).send();
    },
  );

  // --- AI Agent Configs (addressed by lens key + agent key) ---

  app.get(
    "/lenses/:lensKey/ai-agents",
    {
      schema: {
        tags: ["modeling"],
        params: LensKeyParams,
        response: { 200: z.array(AiAgentConfigResponse) },
      },
    },
    async (request) => service.listAiAgents(request.params.lensKey, getModelingStore()),
  );

  app.put(
    "/lenses/:lensKey/ai-agents/:agentKey",
    {
      schema: {
        tags: ["modeling"],
        params: AgentKeyParams,
        body: AiAgentConfigUpsert,
        response: { 200: AiAgentConfigResponse, 201: AiAgentConfigResponse },
      },
    },
    async (request, reply) => {
      const [result, created] = await service.upsertAiAgent(
        request.params.lensKey,
        request.params.agentKey,
        request.body,
        getModelingStore(),
      );
      return reply.status(created ? 201 : 200).send(result);
    },
  );

  app.delete(
    "/lenses/:lensKey/ai-agents/:agentKey",
    {
      schema: { tags: ["modeling"], params: AgentKeyParams },
    },
    async (request, reply) => {
      await service.deleteAiAgent(
        request.params.lensKey,
        request.params.agentKey,
        getModelingStore(),
      );
      return reply.status(204).send();
    },
  );

  // --- Saved Queries (addressed by lens key + query key) ---

  app.get(
    "/lenses/:lensKey/saved-queries",
    {
      schema: {
        tags: ["modeling"],
        params: LensKeyParams,
        response: { 200: z.array(SavedQueryResponse) },
      },
    },
    async (request) => service.listSavedQueries(request.params.lensKey, getModelingStore()),
  );

  app.put(
    "/lenses/:lensKey/saved-queries/:queryKey",
    {
      schema: {
        tags: ["modeling"],
        params: QueryKeyParams,
        body: SavedQueryUpsert,
        response: { 200: SavedQueryResponse, 201: SavedQueryResponse },
      },
    },
    async (request, reply) => {
      const [result, created] = await service.upsertSavedQuery(
        request.params.lensKey,
        request.params.queryKey,
        request.body,
        getModelingStore(),
        getRuntimeStore(),
      );
      return reply.status(created ? 201 : 200).send(result);
    },
  );

  app.delete(
    "/lenses/:lensKey/saved-queries/:queryKey",
    {
      schema: { tags: ["modeling"], params: QueryKeyParams },
    },
    async (request, reply) => {
      await service.deleteSavedQuery(
        request.params.lensKey,
        request.params.queryKey,
        getModelingStore(),
      );
      return reply.status(204).send();
    },
  );

  // --- Rebuild embeddings ---

  app.post(
    "/rebuild-embeddings",
    { schema: { tags: ["modeling"] } },
    async (request, reply) => {
      // Refused before any streaming starts, so the refusal reaches the
      // client in the standard error envelope rather than mid-stream.
      if (!getEmbeddingProvider()) {
        throw new ValidationError(
          "Embedding provider is not configured. Set EMBEDDING_PROVIDER to enable semantic search.",
        );
      }
      const stream = Readable.from(
        service.rebuildEmbeddings(getModelingStore(), getRuntimeStore()),
      );
      return reply.type("application/x-ndjson").send(stream);
    },
  );
};
