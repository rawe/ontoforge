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
import type { AnchorRecord, RuntimeStore } from "../core/ports.js";
import { LENS_RESOURCE_KEY_PATTERN, MAX_KEY_LENGTH } from "../core/schemas.js";
import { loadSearchContext, type EntityTypeDef } from "./schemaCache.js";

const Key = z.string().regex(LENS_RESOURCE_KEY_PATTERN).max(MAX_KEY_LENGTH);

export const ANCHOR_STATES = ["anchored", "unanchored", "dangling"] as const;
export type AnchorState = (typeof ANCHOR_STATES)[number];

const AnchorEntity = z.object({ type: z.string(), id: z.string() });

/** The write body of `PUT`: the entity to point at, or null to unanchor. */
export const AnchorWriteBody = z.strictObject({ entity: AnchorEntity.nullable() });
export type AnchorWriteBody = z.infer<typeof AnchorWriteBody>;

export const AnchorResponse = z.object({
  key: z.string(),
  entity: AnchorEntity.nullable(),
  state: z.enum(ANCHOR_STATES),
});
export type AnchorResponse = z.infer<typeof AnchorResponse>;

/** Every entity type of the ontology, unscoped. */
async function fullEntityTypes(store: RuntimeStore): Promise<Record<string, EntityTypeDef>> {
  return (await loadSearchContext(store.ontologyKey, store.searchIndices())).schema.entityTypes;
}

function toResponse(record: AnchorRecord, entityTypes: Record<string, EntityTypeDef>): AnchorResponse {
  const { entity } = record;
  let state: AnchorState = "unanchored";
  if (entity !== null) {
    state = record.entityFound && Object.hasOwn(entityTypes, entity.type) ? "anchored" : "dangling";
  }
  return { key: record.key, entity, state };
}

/** A storable key: the lens-resource rule. */
export function anchorKeyError(key: string): string | null {
  return Key.safeParse(key).success
    ? null
    : `Invalid anchor key '${key}'. Must match pattern ${LENS_RESOURCE_KEY_PATTERN.source} ` +
        `and be at most ${MAX_KEY_LENGTH} characters`;
}

export async function listAnchors(store: RuntimeStore): Promise<AnchorResponse[]> {
  const records = await store.anchors().listAnchors();
  const entityTypes = await fullEntityTypes(store);
  return records.map((record) => toResponse(record, entityTypes));
}

/** The anchor read fresh, with its state now. Unknown key -> not found. */
export async function readAnchor(key: string, store: RuntimeStore): Promise<AnchorResponse> {
  const record = await store.anchors().getAnchor(key);
  if (record === null) throw new NotFoundError(`Anchor '${key}' not found`);
  return toResponse(record, await fullEntityTypes(store));
}

/** Create or re-point (`PUT`, an idempotent upsert). The entity must be
 * stored, under a type of the full schema. */
export async function saveAnchor(key: string, body: AnchorWriteBody, store: RuntimeStore): Promise<AnchorResponse> {
  const keyError = anchorKeyError(key);
  if (keyError !== null) throw new ValidationError(keyError);
  const { entity } = AnchorWriteBody.parse(body);
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
  return toResponse(await store.anchors().saveAnchor(key, entity), entityTypes);
}

export async function deleteAnchor(key: string, store: RuntimeStore): Promise<void> {
  if (!(await store.anchors().deleteAnchor(key))) {
    throw new NotFoundError(`Anchor '${key}' not found`);
  }
}
