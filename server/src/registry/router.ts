/**
 * Ontology registry REST routes, mounted at `/api` — the registry CRUD
 * surface at `/api/ontologies`. Ontologies are addressed by KEY.
 * Routers parse and shape only — every domain rule lives in
 * `service.ts`. With authentication on, the list holds the ontologies the
 * caller holds a role in, a created ontology's creator becomes its
 * administrator, and a deleted one's assignments go with it
 * (`access/authorize.ts`).
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { visibleOntologies } from "../access/authorize.js";
import { accessOf, actorOf } from "../auth/plugin.js";
import { StoreError } from "../core/exceptions.js";
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
      // With authentication on, the creator administers what it created.
      const access = await accessOf(request);
      if (access.kind === "caller") {
        const actor = access.caller.principal.id;
        try {
          await request.server.auth!.access.assign(
            { principalId: actor, role: "ontology_admin", ontologyId: result.ontologyId, lensId: null },
            actor,
          );
        } catch (error) {
          const failure = new StoreError(
            `Ontology '${result.key}' was created, but making you its administrator failed; ` +
              "a Platform Administrator can assign the role",
          );
          console.error(`Assigning the creator of ontology '${result.key}' failed [${failure.errorId}]:`, error);
          throw failure;
        }
      }
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
    async (request) => {
      return visibleOntologies(await accessOf(request), await service.listOntologies(getOntologyRegistry()));
    },
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
      const registry = getOntologyRegistry();
      const ontologyId = (await registry.getOntology(request.params.ontologyKey))?.ontologyId as string | undefined;
      await service.deleteOntology(request.params.ontologyKey, registry);
      // Its assignments go too, best effort: a leftover is inert, ids are never reused.
      const actor = await actorOf(request);
      if (actor !== null && ontologyId !== undefined) {
        await actor.store.forgetOntology(ontologyId, actor.principalId).catch((error: unknown) => {
          console.error(`Removing the assignments of deleted ontology '${request.params.ontologyKey}' failed:`, error);
        });
      }
      return reply.status(204).send();
    },
  );
};
