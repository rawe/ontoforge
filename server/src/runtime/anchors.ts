/**
 * Anchors: named pointers at one entity of an ontology, maintained over
 * the lensless routes `…/runtime/anchors` (`anchorRouter.ts`). They are
 * operational state, not design: never exported or transferred, and gone
 * with the ontology.
 *
 * The state is decided on every read, from the record read fresh with its
 * join to `entity`, against the FULL schema: no entity is `unanchored`; an
 * entity no longer stored, or of a type no longer in the schema, is
 * `dangling`, never `unanchored`.
 */

import { z } from "zod";

import { NotFoundError, ValidationError } from "../core/exceptions.js";
import type { RulesetRecord, RuntimeStore } from "../core/ports.js";
import { RULESET_KEY_PATTERN, MAX_KEY_LENGTH } from "../core/schemas.js";
import { anchorState } from "./anchorGuard.js";
import { loadSchema, loadSearchContext, type EntityTypeDef } from "./schemaCache.js";
import { getPath } from "./service.js";

const Key = z.string().regex(RULESET_KEY_PATTERN).max(MAX_KEY_LENGTH);

export const ANCHOR_STATES = ["anchored", "unanchored", "dangling"] as const;
export type AnchorState = (typeof ANCHOR_STATES)[number];

const AnchorEntity = z.object({ type: z.string(), id: z.string() });

/** The write body of `PUT`: the entity to point at, or null to unanchor;
 * `stagedOnly` absent keeps the stored flag (V43), false on a new anchor. */
export const AnchorWriteBody = z.strictObject({
  entity: AnchorEntity.nullable(),
  stagedOnly: z.boolean().optional(),
});
export type AnchorWriteBody = z.infer<typeof AnchorWriteBody>;

export const AnchorResponse = z.object({
  key: z.string(),
  entity: AnchorEntity.nullable(),
  state: z.enum(ANCHOR_STATES),
  stagedOnly: z.boolean(),
});
export type AnchorResponse = z.infer<typeof AnchorResponse>;

const PathStep = z.object({ type: z.string(), id: z.string(), name: z.string().nullable() });

/** The anchor as an anchored mount shows it (`get_anchor`, the REST
 * mirror's root). `visible` is false only when the anchor is anchored and
 * the lens hides the entity's type; entity null and path [] whenever
 * there is no entity to show. */
export const AnchorView = z.object({
  key: z.string(),
  state: z.enum(ANCHOR_STATES),
  stagedOnly: z.boolean(),
  visible: z.boolean(),
  entity: PathStep.nullable(),
  path: z.array(PathStep),
});
export type AnchorView = z.infer<typeof AnchorView>;

/** Every entity type of the ontology, unscoped. */
async function fullEntityTypes(store: RuntimeStore): Promise<Record<string, EntityTypeDef>> {
  return (await loadSearchContext(store.ontologyKey, store.searchIndices())).schema.entityTypes;
}

function toResponse(record: RulesetRecord, entityTypes: Record<string, EntityTypeDef>): AnchorResponse {
  return {
    key: record.key,
    entity: record.anchor,
    state: anchorState(record, entityTypes),
    stagedOnly: record.writeAccess === "propose", // bridge: removed in 05
  };
}

/** A storable key: the anchor key rule. */
export function anchorKeyError(key: string): string | null {
  return Key.safeParse(key).success
    ? null
    : `Invalid anchor key '${key}'. Must match pattern ${RULESET_KEY_PATTERN.source} ` +
        `and be at most ${MAX_KEY_LENGTH} characters`;
}

export async function listAnchors(store: RuntimeStore): Promise<AnchorResponse[]> {
  const records = await store.rulesets().list();
  const entityTypes = await fullEntityTypes(store);
  return records.map((record) => toResponse(record, entityTypes));
}

/** The anchor read fresh, with its state now. Unknown key -> not found. */
export async function readAnchor(key: string, store: RuntimeStore): Promise<AnchorResponse> {
  const record = await store.rulesets().get(key);
  if (record === null) throw new NotFoundError(`Anchor '${key}' not found`);
  return toResponse(record, await fullEntityTypes(store));
}

/** Create or re-point (`PUT`, an idempotent upsert). The entity must be
 * stored, under a type of the full schema. Without `stagedOnly` the
 * stored flag is kept (V43). */
export async function saveAnchor(key: string, body: AnchorWriteBody, store: RuntimeStore): Promise<AnchorResponse> {
  const keyError = anchorKeyError(key);
  if (keyError !== null) throw new ValidationError(keyError);
  const { entity, stagedOnly } = AnchorWriteBody.parse(body);
  const entityTypes = await fullEntityTypes(store);
  if (entity !== null) {
    if (!Object.hasOwn(entityTypes, entity.type)) {
      throw new ValidationError("Anchor validation failed", {
        fields: { "entity.type": `Entity type '${entity.type}' not found` },
      });
    }
    if ((await store.getEntity(entity.type, entity.id)) === null) {
      throw new ValidationError("Anchor validation failed", {
        fields: { "entity.id": `Entity '${entity.id}' of type '${entity.type}' not found` },
      });
    }
  }
  const writeAccess = stagedOnly === undefined ? undefined : stagedOnly ? "propose" : "full"; // bridge: removed in 05
  return toResponse(await store.rulesets().save(key, { anchor: entity, writeAccess }), entityTypes);
}

export async function deleteAnchor(key: string, store: RuntimeStore): Promise<void> {
  if (!(await store.rulesets().delete(key))) {
    throw new NotFoundError(`Anchor '${key}' not found`);
  }
}

/**
 * The binding of an anchored mount, checked on every request in the
 * not-found order ontology (the caller's `getRuntimeStore`), lens, anchor.
 * The record is read fresh and never created; its write access is what
 * the entrance checks (`writeAccess.ts`).
 */
export async function readMountRuleset(lensKey: string, anchorKey: string, store: RuntimeStore): Promise<RulesetRecord> {
  await loadSchema(lensKey, store);
  const record = await store.rulesets().get(anchorKey);
  if (record === null) throw new NotFoundError(`Anchor '${anchorKey}' not found`);
  return record;
}

/** `get_anchor`: the anchor through the lens, with the entity's name and
 * its path (root first, ending with the entity, below the nearest hidden
 * ancestor). */
export async function getAnchorView(lensKey: string, anchorKey: string, store: RuntimeStore): Promise<AnchorView> {
  const anchor = toResponse(await readMountRuleset(lensKey, anchorKey, store), await fullEntityTypes(store));
  const nothing = { key: anchor.key, stagedOnly: anchor.stagedOnly, entity: null, path: [] };
  if (anchor.state !== "anchored" || anchor.entity === null) {
    return { ...nothing, state: anchor.state, visible: true };
  }
  const { type, id } = anchor.entity;
  if (!Object.hasOwn((await loadSchema(lensKey, store)).scoped.entityTypes, type)) {
    return { ...nothing, state: "anchored", visible: false };
  }
  let path;
  try {
    path = await getPath(lensKey, type, id, store);
  } catch (error) {
    // Deleted between the anchor read and the path read.
    if (error instanceof NotFoundError) return { ...nothing, state: "dangling", visible: true };
    throw error;
  }
  return {
    key: anchor.key,
    state: "anchored",
    stagedOnly: anchor.stagedOnly,
    visible: true,
    entity: path[path.length - 1]!,
    path,
  };
}
