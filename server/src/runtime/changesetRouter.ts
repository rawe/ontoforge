/**
 * Changeset routes, mounted at
 * `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey/changesets`, and
 * below the ruleset mirror at `…/rulesets/:rulesetKey/changesets`
 * (`rulesetRouter.ts`, whose hooks check the ruleset first).
 *
 * `POST /:changesetId/writes` stages one call, its body discriminated by
 * `operation`, and answers 201 `{id}` (a create with a parent relation
 * adds `relation: {id}`, an entity delete `cascaded`, a document edit the
 * document edit's answer). `DELETE /:changesetId/objects/:objectId`
 * unstages one staged object, `DELETE …/objects/:objectId/properties/:propertyKey`
 * cuts one staged value, and `POST …/objects/:objectId/rebase` accepts the
 * stored values now as the befores. `GET /` lists the lens's changesets (a
 * ruleset URL: its ruleset's), `GET /:changesetId` is the review read, and
 * `GET /:changesetId/documents/:entityTypeKey/:entityId/:propertyKey` the
 * staged text of one document property, with the document read's paging,
 * and `GET /:changesetId/entities/:entityTypeKey/:entityId` one entity as
 * a commit would leave it, with its staged object (its twin
 * `…/identity/:identity` names it by identity in the changeset's view); `POST
 * /:changesetId/submit` and `/unsubmit` hand it over and back, `POST
 * /:changesetId/check` runs the commit and rolls it back, and `POST
 * /:changesetId/commit` persists it all or nothing. No read outside these
 * changeset routes sees staged data.
 * Routers parse and shape only; every rule lives in `changesets.ts`.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getRuntimeStore } from "../core/ports.js";
import * as changesets from "./changesets.js";
import {
  DocumentEditFields,
  DocumentReadQuery,
  LensParams,
  ParentRelationPayload,
  PropertyPayload,
  rulesetOf,
} from "./router.js";

const ChangesetParams = LensParams.extend({ changesetId: z.string() });
const EntityParams = ChangesetParams.extend({ entityTypeKey: z.string(), entityId: z.string() });
const IdentityParams = ChangesetParams.extend({ entityTypeKey: z.string(), identity: z.string() });
const DocumentParams = EntityParams.extend({ propertyKey: z.string() });
const ObjectParams = ChangesetParams.extend({ objectId: z.string() });
const ValueParams = ObjectParams.extend({ propertyKey: z.string() });

const StartPayload = z.strictObject({ note: z.string().nullish() }).nullish();

/** Submit: the note is optional (absent, the note stays); unsubmit: the
 * service requires one, so its 422 names `fields.note`. */
const NotePayload = z.strictObject({ note: z.string().nullish() }).nullish();

/** The keys of an object's values to rebase; without them, all. */
const RebasePayload = z.strictObject({ properties: z.array(z.string()).optional() }).nullish();

/** The version the caller looked at; without it, any version commits. */
const CommitPayload = z.strictObject({ expectedVersion: z.number().int().min(1).optional() }).nullish();

/** The staged objects of a changeset by first touch: default 100, at most 500. */
const PageQuery = z.looseObject({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const Properties = PropertyPayload.default({});

/** The target entity of a staged update, delete or document edit: by
 * `id` or by `identity`, exactly one (the service's 422). */
const EntityTarget = { id: z.string().optional(), identity: z.string().optional() };

/** One staged call: `type` is the entity or relation type key, `id` the
 * target of an update, delete or document edit (an entity's, or its
 * `identity`); a document edit carries the body of the document PATCH
 * beside `property`. */
const StagedWritePayload = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("create_entity"),
    type: z.string(),
    properties: Properties,
    parentRelation: ParentRelationPayload.optional(),
  }),
  z.strictObject({ operation: z.literal("update_entity"), type: z.string(), ...EntityTarget, properties: Properties }),
  z.strictObject({ operation: z.literal("delete_entity"), type: z.string(), ...EntityTarget }),
  z.strictObject({
    operation: z.literal("create_relation"),
    type: z.string(),
    fromEntityId: z.string().optional(),
    toEntityId: z.string().optional(),
    fromEntityIdentity: z.string().optional(),
    toEntityIdentity: z.string().optional(),
    properties: Properties,
  }),
  z.strictObject({ operation: z.literal("update_relation"), type: z.string(), id: z.string(), properties: Properties }),
  z.strictObject({ operation: z.literal("delete_relation"), type: z.string(), id: z.string() }),
  z.strictObject({
    operation: z.literal("edit_document"),
    type: z.string(),
    ...EntityTarget,
    property: z.string(),
    ...DocumentEditFields,
  }),
]);

function stagedWrite(body: z.infer<typeof StagedWritePayload>): changesets.StagedWrite {
  const typeKey = body.type;
  switch (body.operation) {
    case "create_entity":
      return { operation: body.operation, typeKey, properties: body.properties, parentRelation: body.parentRelation ?? null };
    case "create_relation":
      return {
        operation: body.operation,
        typeKey,
        fromEntityId: body.fromEntityId,
        toEntityId: body.toEntityId,
        fromEntityIdentity: body.fromEntityIdentity,
        toEntityIdentity: body.toEntityIdentity,
        properties: body.properties,
      };
    case "update_entity":
      return { operation: body.operation, typeKey, id: body.id, identity: body.identity, properties: body.properties };
    case "update_relation":
      return { operation: body.operation, typeKey, id: body.id, properties: body.properties };
    case "delete_entity":
      return { operation: body.operation, typeKey, id: body.id, identity: body.identity };
    case "delete_relation":
      return { operation: body.operation, typeKey, id: body.id };
    case "edit_document": {
      const { op, oldString, newString, replaceAll, offset, length, content, expect } = body;
      const edit = { op, oldString, newString, replaceAll, offset, length, content, expect };
      return { operation: body.operation, typeKey, id: body.id, identity: body.identity, propertyKey: body.property, edit };
    }
  }
}

export const changesetRouter: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/",
    { schema: { tags: ["runtime"], params: LensParams, body: StartPayload } },
    async (request, reply) => {
      const changeset = await changesets.startChangeset(
        request.params.lensKey,
        rulesetOf(request.params),
        request.body?.note,
        await getRuntimeStore(request.params.ontologyKey),
      );
      return reply.status(201).send(changeset);
    },
  );

  app.get(
    "/",
    { schema: { tags: ["runtime"], params: LensParams } },
    async (request) =>
      changesets.listChangesets(
        request.params.lensKey,
        rulesetOf(request.params),
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.get(
    "/:changesetId",
    { schema: { tags: ["runtime"], params: ChangesetParams, querystring: PageQuery } },
    async (request) =>
      changesets.getChangeset(
        request.params.lensKey,
        rulesetOf(request.params),
        request.params.changesetId,
        request.query.offset,
        request.query.limit,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.get(
    "/:changesetId/documents/:entityTypeKey/:entityId/:propertyKey",
    { schema: { tags: ["runtime"], params: DocumentParams, querystring: DocumentReadQuery } },
    async (request) =>
      changesets.getStagedDocument(
        request.params.lensKey,
        rulesetOf(request.params),
        request.params.changesetId,
        request.params.entityTypeKey,
        request.params.entityId,
        request.params.propertyKey,
        request.query.offset,
        request.query.limit ?? null,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.get(
    "/:changesetId/entities/:entityTypeKey/:entityId",
    { schema: { tags: ["runtime"], params: EntityParams } },
    async (request) =>
      changesets.getStagedEntity(
        request.params.lensKey,
        rulesetOf(request.params),
        request.params.changesetId,
        request.params.entityTypeKey,
        request.params.entityId,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.get(
    "/:changesetId/entities/:entityTypeKey/identity/:identity",
    { schema: { tags: ["runtime"], params: IdentityParams } },
    async (request) =>
      changesets.getStagedEntityByIdentity(
        request.params.lensKey,
        rulesetOf(request.params),
        request.params.changesetId,
        request.params.entityTypeKey,
        request.params.identity,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.delete(
    "/:changesetId",
    { schema: { tags: ["runtime"], params: ChangesetParams } },
    async (request, reply) => {
      await changesets.discardChangeset(
        request.params.lensKey,
        rulesetOf(request.params),
        request.params.changesetId,
        await getRuntimeStore(request.params.ontologyKey),
      );
      return reply.status(204).send();
    },
  );

  app.post(
    "/:changesetId/writes",
    { schema: { tags: ["runtime"], params: ChangesetParams, body: StagedWritePayload } },
    async (request, reply) => {
      const answer = await changesets.stage(
        request.params.lensKey,
        rulesetOf(request.params),
        request.params.changesetId,
        stagedWrite(request.body),
        await getRuntimeStore(request.params.ontologyKey),
      );
      return reply.status(201).send(answer);
    },
  );

  app.delete(
    "/:changesetId/objects/:objectId",
    { schema: { tags: ["runtime"], params: ObjectParams } },
    async (request, reply) => {
      await changesets.unstage(
        request.params.lensKey,
        rulesetOf(request.params),
        request.params.changesetId,
        request.params.objectId,
        null,
        await getRuntimeStore(request.params.ontologyKey),
      );
      return reply.status(204).send();
    },
  );

  app.delete(
    "/:changesetId/objects/:objectId/properties/:propertyKey",
    { schema: { tags: ["runtime"], params: ValueParams } },
    async (request, reply) => {
      await changesets.unstage(
        request.params.lensKey,
        rulesetOf(request.params),
        request.params.changesetId,
        request.params.objectId,
        request.params.propertyKey,
        await getRuntimeStore(request.params.ontologyKey),
      );
      return reply.status(204).send();
    },
  );

  app.post(
    "/:changesetId/objects/:objectId/rebase",
    { schema: { tags: ["runtime"], params: ObjectParams, body: RebasePayload } },
    async (request) =>
      changesets.rebase(
        request.params.lensKey,
        rulesetOf(request.params),
        request.params.changesetId,
        request.params.objectId,
        request.body?.properties ?? null,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.post(
    "/:changesetId/submit",
    { schema: { tags: ["runtime"], params: ChangesetParams, body: NotePayload } },
    async (request) =>
      changesets.submitChangeset(
        request.params.lensKey,
        rulesetOf(request.params),
        request.params.changesetId,
        request.body?.note,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.post(
    "/:changesetId/unsubmit",
    { schema: { tags: ["runtime"], params: ChangesetParams, body: NotePayload } },
    async (request) =>
      changesets.unsubmitChangeset(
        request.params.lensKey,
        rulesetOf(request.params),
        request.params.changesetId,
        request.body?.note,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );

  app.post("/:changesetId/check", { schema: { tags: ["runtime"], params: ChangesetParams } }, async (request) =>
    changesets.checkChangeset(
      request.params.lensKey,
      rulesetOf(request.params),
      request.params.changesetId,
      await getRuntimeStore(request.params.ontologyKey),
    ),
  );

  app.post(
    "/:changesetId/commit",
    { schema: { tags: ["runtime"], params: ChangesetParams, body: CommitPayload } },
    async (request) =>
      changesets.commitChangeset(
        request.params.lensKey,
        rulesetOf(request.params),
        request.params.changesetId,
        request.body?.expectedVersion,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );
};
