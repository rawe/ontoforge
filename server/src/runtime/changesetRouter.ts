/**
 * Changeset routes, mounted at
 * `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey/changesets`, and
 * below the anchored mirror at `…/anchors/:anchorKey/changesets`
 * (`anchorRouter.ts`, whose hooks check the anchor first).
 *
 * The staged write routes under `/:changesetId/` have the paths and bodies
 * of the six write routes of `router.ts` and answer 202 `{seq, id}`. No
 * read route is mounted under a changeset: reads never see staged data.
 * Routers parse and shape only; every rule lives in `changesets.ts`.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyReply } from "fastify";
import { z } from "zod";

import { getRuntimeStore } from "../core/ports.js";
import * as changesets from "./changesets.js";
import { EntityCreatePayload, LensParams, PropertyPayload, RelationCreatePayload, anchorOf } from "./router.js";

const ChangesetParams = LensParams.extend({ changesetId: z.string() });
const EntityTypeParams = ChangesetParams.extend({ entityTypeKey: z.string() });
const EntityParams = EntityTypeParams.extend({ entityId: z.string() });
const RelationTypeParams = ChangesetParams.extend({ relationTypeKey: z.string() });
const RelationParams = RelationTypeParams.extend({ relationId: z.string() });
const WriteParams = ChangesetParams.extend({ seq: z.coerce.number().int().min(1) });

const StartPayload = z.strictObject({ note: z.string().nullish() }).nullish();

/** The writes of a changeset by seq: default 100, at most 500 (R7). */
const PageQuery = z.looseObject({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

type Params = z.infer<typeof ChangesetParams>;

async function staged(
  params: Params,
  write: changesets.StagedWrite,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const answer = await changesets.stage(
    params.lensKey,
    anchorOf(params),
    params.changesetId,
    write,
    await getRuntimeStore(params.ontologyKey),
  );
  return reply.status(202).send(answer);
}

export const changesetRouter: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/",
    { schema: { tags: ["runtime"], params: LensParams, body: StartPayload } },
    async (request, reply) => {
      const changeset = await changesets.startChangeset(
        request.params.lensKey,
        anchorOf(request.params),
        request.body?.note,
        await getRuntimeStore(request.params.ontologyKey),
      );
      return reply.status(201).send(changeset);
    },
  );

  app.get(
    "/:changesetId",
    { schema: { tags: ["runtime"], params: ChangesetParams, querystring: PageQuery } },
    async (request) =>
      changesets.getChangeset(
        request.params.lensKey,
        anchorOf(request.params),
        request.params.changesetId,
        request.query.offset,
        request.query.limit,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.delete(
    "/:changesetId",
    { schema: { tags: ["runtime"], params: ChangesetParams } },
    async (request, reply) => {
      await changesets.discardChangeset(
        request.params.lensKey,
        anchorOf(request.params),
        request.params.changesetId,
        await getRuntimeStore(request.params.ontologyKey),
      );
      return reply.status(204).send();
    },
  );

  app.delete(
    "/:changesetId/writes/:seq",
    { schema: { tags: ["runtime"], params: WriteParams } },
    async (request, reply) => {
      await changesets.unstage(
        request.params.lensKey,
        anchorOf(request.params),
        request.params.changesetId,
        request.params.seq,
        await getRuntimeStore(request.params.ontologyKey),
      );
      return reply.status(204).send();
    },
  );

  // --- Staged writes: the paths and bodies of the immediate writes ---

  app.post(
    "/:changesetId/entities/:entityTypeKey",
    { schema: { tags: ["runtime"], params: EntityTypeParams, body: EntityCreatePayload } },
    async (request, reply) => {
      const { parentRelation, ...properties } = request.body;
      return staged(
        request.params,
        {
          operation: "create_entity",
          typeKey: request.params.entityTypeKey,
          properties,
          parentRelation: parentRelation ?? null,
        },
        reply,
      );
    },
  );

  app.patch(
    "/:changesetId/entities/:entityTypeKey/:entityId",
    { schema: { tags: ["runtime"], params: EntityParams, body: PropertyPayload } },
    async (request, reply) =>
      staged(
        request.params,
        {
          operation: "update_entity",
          typeKey: request.params.entityTypeKey,
          id: request.params.entityId,
          properties: request.body,
        },
        reply,
      ),
  );

  app.delete(
    "/:changesetId/entities/:entityTypeKey/:entityId",
    { schema: { tags: ["runtime"], params: EntityParams } },
    async (request, reply) =>
      staged(
        request.params,
        { operation: "delete_entity", typeKey: request.params.entityTypeKey, id: request.params.entityId },
        reply,
      ),
  );

  app.post(
    "/:changesetId/relations/:relationTypeKey",
    { schema: { tags: ["runtime"], params: RelationTypeParams, body: RelationCreatePayload } },
    async (request, reply) => {
      const { fromEntityId, toEntityId, ...properties } = request.body;
      return staged(
        request.params,
        {
          operation: "create_relation",
          typeKey: request.params.relationTypeKey,
          fromEntityId,
          toEntityId,
          properties,
        },
        reply,
      );
    },
  );

  app.patch(
    "/:changesetId/relations/:relationTypeKey/:relationId",
    { schema: { tags: ["runtime"], params: RelationParams, body: PropertyPayload } },
    async (request, reply) =>
      staged(
        request.params,
        {
          operation: "update_relation",
          typeKey: request.params.relationTypeKey,
          id: request.params.relationId,
          properties: request.body,
        },
        reply,
      ),
  );

  app.delete(
    "/:changesetId/relations/:relationTypeKey/:relationId",
    { schema: { tags: ["runtime"], params: RelationParams } },
    async (request, reply) =>
      staged(
        request.params,
        { operation: "delete_relation", typeKey: request.params.relationTypeKey, id: request.params.relationId },
        reply,
      ),
  );
};
