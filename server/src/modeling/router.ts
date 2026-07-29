/**
 * Modeling REST routes, mounted at `/api/model`.
 *
 * This surface is global and addresses types and properties by INTERNAL
 * IDENTIFIER, not key (`docs/interfaces.md`, "What a path segment
 * identifies"). Routers parse and shape only — every domain rule lives in
 * `service.ts`, shared with the modeling MCP server.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getModelingStore } from "../core/ports.js";
import {
  EntityTypeCreate,
  EntityTypeResponse,
  EntityTypeUpdate,
  PropertyDefinitionCreate,
  PropertyDefinitionResponse,
  PropertyDefinitionUpdate,
  RelationTypeCreate,
  RelationTypeResponse,
  RelationTypeUpdate,
} from "./schemas.js";
import * as service from "./service.js";

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

// `cascade` arrives as a query-string token; accept the boolean spellings
// the Python server accepts from its clients.
const CascadeQuery = z.object({
  cascade: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((value) => value === "true" || value === "1"),
});

/** Routes mounted at `/api/model`. */
export const modelingRouter: FastifyPluginAsyncZod = async (app) => {
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
};
