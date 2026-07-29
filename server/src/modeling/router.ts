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
  IncludeTypeRequest,
  IncludeTypeResponse,
  IncludeTypeUpdate,
  OntologyCreate,
  OntologyResponse,
  OntologyUpdate,
  PropertyDefinitionCreate,
  PropertyDefinitionResponse,
  PropertyDefinitionUpdate,
  RelationTypeCreate,
  RelationTypeResponse,
  RelationTypeUpdate,
  ValidationResult,
} from "./schemas.js";
import * as service from "./service.js";

const OntologyIdParams = z.object({ ontologyId: z.string() });
const OntologyTypeParams = z.object({ ontologyId: z.string(), typeId: z.string() });
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
  // --- Ontologies ---

  app.post(
    "/ontologies",
    {
      schema: {
        tags: ["modeling"],
        body: OntologyCreate,
        response: { 201: OntologyResponse },
      },
    },
    async (request, reply) => {
      const result = await service.createOntology(request.body, getModelingStore());
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/ontologies",
    {
      schema: {
        tags: ["modeling"],
        response: { 200: z.array(OntologyResponse) },
      },
    },
    async () => service.listOntologies(getModelingStore()),
  );

  app.get(
    "/ontologies/:ontologyId",
    {
      schema: {
        tags: ["modeling"],
        params: OntologyIdParams,
        response: { 200: OntologyResponse },
      },
    },
    async (request) => service.getOntology(request.params.ontologyId, getModelingStore()),
  );

  app.put(
    "/ontologies/:ontologyId",
    {
      schema: {
        tags: ["modeling"],
        params: OntologyIdParams,
        body: OntologyUpdate,
        response: { 200: OntologyResponse },
      },
    },
    async (request) =>
      service.updateOntology(request.params.ontologyId, request.body, getModelingStore()),
  );

  app.delete(
    "/ontologies/:ontologyId",
    {
      schema: {
        tags: ["modeling"],
        params: OntologyIdParams,
      },
    },
    async (request, reply) => {
      await service.deleteOntology(request.params.ontologyId, getModelingStore());
      return reply.status(204).send();
    },
  );

  // --- Scope Management ---
  // Adding an inclusion names the type by KEY in the body; updating or
  // removing one names it by INTERNAL IDENTIFIER in the path.

  app.post(
    "/ontologies/:ontologyId/includes/entity-types",
    {
      schema: {
        tags: ["modeling"],
        params: OntologyIdParams,
        body: IncludeTypeRequest,
        response: { 201: IncludeTypeResponse },
      },
    },
    async (request, reply) => {
      const result = await service.addIncludesEntityType(
        request.params.ontologyId,
        request.body,
        getModelingStore(),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/ontologies/:ontologyId/includes/entity-types",
    {
      schema: {
        tags: ["modeling"],
        params: OntologyIdParams,
        response: { 200: z.array(IncludeTypeResponse) },
      },
    },
    async (request) =>
      service.listIncludesEntityTypes(request.params.ontologyId, getModelingStore()),
  );

  app.put(
    "/ontologies/:ontologyId/includes/entity-types/:typeId",
    {
      schema: {
        tags: ["modeling"],
        params: OntologyTypeParams,
        body: IncludeTypeUpdate,
        response: { 200: IncludeTypeResponse },
      },
    },
    async (request) =>
      service.updateIncludesEntityType(
        request.params.ontologyId,
        request.params.typeId,
        request.body,
        getModelingStore(),
      ),
  );

  app.delete(
    "/ontologies/:ontologyId/includes/entity-types/:typeId",
    {
      schema: {
        tags: ["modeling"],
        params: OntologyTypeParams,
      },
    },
    async (request, reply) => {
      await service.removeIncludesEntityType(
        request.params.ontologyId,
        request.params.typeId,
        getModelingStore(),
      );
      return reply.status(204).send();
    },
  );

  app.post(
    "/ontologies/:ontologyId/includes/relation-types",
    {
      schema: {
        tags: ["modeling"],
        params: OntologyIdParams,
        body: IncludeTypeRequest,
        response: { 201: IncludeTypeResponse },
      },
    },
    async (request, reply) => {
      const result = await service.addIncludesRelationType(
        request.params.ontologyId,
        request.body,
        getModelingStore(),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/ontologies/:ontologyId/includes/relation-types",
    {
      schema: {
        tags: ["modeling"],
        params: OntologyIdParams,
        response: { 200: z.array(IncludeTypeResponse) },
      },
    },
    async (request) =>
      service.listIncludesRelationTypes(request.params.ontologyId, getModelingStore()),
  );

  app.put(
    "/ontologies/:ontologyId/includes/relation-types/:typeId",
    {
      schema: {
        tags: ["modeling"],
        params: OntologyTypeParams,
        body: IncludeTypeUpdate,
        response: { 200: IncludeTypeResponse },
      },
    },
    async (request) =>
      service.updateIncludesRelationType(
        request.params.ontologyId,
        request.params.typeId,
        request.body,
        getModelingStore(),
      ),
  );

  app.delete(
    "/ontologies/:ontologyId/includes/relation-types/:typeId",
    {
      schema: {
        tags: ["modeling"],
        params: OntologyTypeParams,
      },
    },
    async (request, reply) => {
      await service.removeIncludesRelationType(
        request.params.ontologyId,
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
    "/ontologies/:ontologyId/validate",
    {
      schema: {
        tags: ["modeling"],
        params: OntologyIdParams,
        response: { 200: ValidationResult },
      },
    },
    async (request) => service.validateOntology(request.params.ontologyId, getModelingStore()),
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
