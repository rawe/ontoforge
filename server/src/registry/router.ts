/**
 * Ontology registry REST routes, mounted at `/api` — the registry CRUD
 * surface at `/api/ontologies`. Ontologies are addressed by KEY.
 * Routers parse and shape only — every domain rule lives in
 * `service.ts`.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getOntologyRegistry } from "../core/ports.js";
import { OntologyCreate, OntologyRename, OntologyResponse } from "./schemas.js";
import * as service from "./service.js";

// Param name matches the modeling subtree (`/api/ontologies/:ontologyKey/model`)
// mounted at the same segment — the router requires one spelling per position.
const OntologyKeyParams = z.object({ ontologyKey: z.string() });

/** Routes mounted at `/api`. */
export const registryRouter: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/ontologies",
    {
      schema: {
        tags: ["registry"],
        body: OntologyCreate,
        response: { 201: OntologyResponse },
      },
    },
    async (request, reply) => {
      const result = await service.createOntology(request.body, getOntologyRegistry());
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/ontologies",
    {
      schema: {
        tags: ["registry"],
        response: { 200: z.array(OntologyResponse) },
      },
    },
    async () => service.listOntologies(getOntologyRegistry()),
  );

  app.get(
    "/ontologies/:ontologyKey",
    {
      schema: {
        tags: ["registry"],
        params: OntologyKeyParams,
        response: { 200: OntologyResponse },
      },
    },
    async (request) => service.getOntology(request.params.ontologyKey, getOntologyRegistry()),
  );

  app.patch(
    "/ontologies/:ontologyKey",
    {
      schema: {
        tags: ["registry"],
        params: OntologyKeyParams,
        body: OntologyRename,
        response: { 200: OntologyResponse },
      },
    },
    async (request) =>
      service.renameOntology(request.params.ontologyKey, request.body, getOntologyRegistry()),
  );

  app.delete(
    "/ontologies/:ontologyKey",
    {
      schema: {
        tags: ["registry"],
        params: OntologyKeyParams,
      },
    },
    async (request, reply) => {
      await service.deleteOntology(request.params.ontologyKey, getOntologyRegistry());
      return reply.status(204).send();
    },
  );
};
