/**
 * User management REST routes, mounted at `/api` only when authentication
 * is on: `/api/users` and an ontology's access list. The route table
 * (`routes.ts`) lets in Platform Administrators and Ontology
 * Administrators; every narrower rule lives in `service.ts`.
 */

import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { accessOf } from "../auth/plugin.js";
import { UnauthenticatedError } from "../core/exceptions.js";
import type { Caller } from "./caller.js";
import { Assignment, Role, User } from "./schemas.js";
import * as service from "./service.js";
import type { AccessStore } from "./store.js";

const UserParams = z.object({ userId: z.string() });
const AssignmentParams = UserParams.extend({ assignmentId: z.string() });
const UsersQuery = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const StatusBody = z.object({ status: z.enum(["active", "disabled"]) }).strict();
const ServiceBody = z
  .object({ kind: z.literal("service"), displayName: z.string().min(1), subject: z.string().min(1) })
  .strict();
const GrantBody = z
  .object({ role: Role, ontologyKey: z.string().optional(), lensKey: z.string().optional() })
  .strict();

/** The signed-in caller; the route table already refused anyone else. */
async function callerOf(request: FastifyRequest): Promise<Caller> {
  const access = await accessOf(request);
  if (access.kind !== "caller") throw new UnauthenticatedError();
  return access.caller;
}

function storeOf(request: FastifyRequest): AccessStore {
  return request.server.auth!.access;
}

function configuredAdmin(request: FastifyRequest): service.ConfiguredAdmin {
  const { issuer, adminSubject } = request.server.auth!.settings;
  return { issuer, subject: adminSubject };
}

/** Routes mounted at `/api`. */
export const accessRouter: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/users",
    { schema: { tags: ["users"], querystring: UsersQuery, response: { 200: z.object({ items: z.array(User), total: z.number() }) } } },
    async (request) => {
      await callerOf(request);
      return service.listUsers(storeOf(request), request.query);
    },
  );

  app.post(
    "/users",
    { schema: { tags: ["users"], body: ServiceBody, response: { 201: User } } },
    async (request, reply) => {
      const user = await service.admitService(
        storeOf(request),
        await callerOf(request),
        request.server.auth!.settings.issuer,
        request.body,
      );
      return reply.status(201).send(user);
    },
  );

  app.get(
    "/users/:userId",
    { schema: { tags: ["users"], params: UserParams, response: { 200: User.extend({ assignments: z.array(Assignment) }) } } },
    async (request) => service.getUser(storeOf(request), await callerOf(request), request.params.userId),
  );

  app.patch(
    "/users/:userId",
    { schema: { tags: ["users"], params: UserParams, body: StatusBody, response: { 200: User } } },
    async (request) =>
      service.setUserStatus(
        storeOf(request),
        await callerOf(request),
        configuredAdmin(request),
        request.params.userId,
        request.body.status,
      ),
  );

  app.post(
    "/users/:userId/assignments",
    { schema: { tags: ["users"], params: UserParams, body: GrantBody, response: { 201: Assignment } } },
    async (request, reply) => {
      const assignment = await service.grant(storeOf(request), await callerOf(request), request.params.userId, request.body);
      return reply.status(201).send(assignment);
    },
  );

  app.delete(
    "/users/:userId/assignments/:assignmentId",
    { schema: { tags: ["users"], params: AssignmentParams } },
    async (request, reply) => {
      await service.revoke(
        storeOf(request),
        await callerOf(request),
        configuredAdmin(request),
        request.params.userId,
        request.params.assignmentId,
      );
      return reply.status(204).send();
    },
  );

  app.get(
    "/ontologies/:ontologyKey/access",
    {
      schema: {
        tags: ["users"],
        params: z.object({ ontologyKey: z.string() }),
        response: { 200: z.object({ assignments: z.array(Assignment.extend({ user: User })) }) },
      },
    },
    async (request) => service.ontologyAccess(storeOf(request), await callerOf(request), request.params.ontologyKey),
  );
};
