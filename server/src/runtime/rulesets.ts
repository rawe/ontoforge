/**
 * Rulesets: named records of an ontology whose key is part of a client's
 * URL, each with the rules of that URL: write access (`writeAccess.ts`)
 * and the anchor (`anchorGuard.ts`). Maintained over the lensless routes
 * `…/runtime/rulesets` (`rulesetRouter.ts`). They are operational state,
 * not design: never exported or transferred, and gone with the ontology.
 *
 * The anchor's state is decided on every read, from the record read fresh
 * with its join to `entity`, against the FULL schema: `found`, or
 * `deleted` for an entity no longer stored or of a type no longer in the
 * schema. No anchor is `anchor: null`, not a state.
 */

import { z } from "zod";

import { NotFoundError, ValidationError } from "../core/exceptions.js";
import type { RulesetRecord, RuntimeStore, WriteAccess } from "../core/ports.js";
import { MAX_KEY_LENGTH, RULESET_KEY_PATTERN } from "../core/schemas.js";
import { anchorState } from "./anchorGuard.js";
import { loadSchema, loadSearchContext, type EntityTypeDef } from "./schemaCache.js";
import { getPath } from "./service.js";
import { LEVELS } from "./writeAccess.js";

const Key = z.string().regex(RULESET_KEY_PATTERN).max(MAX_KEY_LENGTH);

export const ANCHOR_STATES = ["found", "deleted"] as const;
export type AnchorState = (typeof ANCHOR_STATES)[number];

const Level = z.enum(Object.keys(LEVELS) as [WriteAccess, ...WriteAccess[]]);

const AnchorEntity = z.object({ type: z.string(), id: z.string() });

/** The write body of `PUT`, a patch: a rule left out keeps its stored
 * value (a new ruleset: no anchor, write access `full`), `anchor: null`
 * removes the anchor. The level is checked by `saveRuleset`. */
export const RulesetWriteBody = z.strictObject({
  anchor: AnchorEntity.nullable().optional(),
  writeAccess: z.string().optional(),
});
export type RulesetWriteBody = z.infer<typeof RulesetWriteBody>;

export const RulesetResponse = z.object({
  key: z.string(),
  anchor: AnchorEntity.extend({ state: z.enum(ANCHOR_STATES) }).nullable(),
  writeAccess: Level,
});
export type RulesetResponse = z.infer<typeof RulesetResponse>;

const PathStep = z.object({ type: z.string(), id: z.string(), name: z.string().nullable() });

/** The ruleset as a ruleset mount shows it (`get_anchor`, the REST
 * mirror's root). `visible` is false when the lens hides the anchor's
 * type; type, id and name null and path [] whenever there is no entity to
 * show (deleted or not visible). */
export const RulesetView = z.object({
  key: z.string(),
  writeAccess: Level,
  anchor: z
    .object({
      type: z.string().nullable(),
      id: z.string().nullable(),
      name: z.string().nullable(),
      state: z.enum(ANCHOR_STATES),
      visible: z.boolean(),
      path: z.array(PathStep),
    })
    .nullable(),
});
export type RulesetView = z.infer<typeof RulesetView>;

/** Every entity type of the ontology, unscoped. */
async function fullEntityTypes(store: RuntimeStore): Promise<Record<string, EntityTypeDef>> {
  return (await loadSearchContext(store.ontologyKey, store.searchIndices())).schema.entityTypes;
}

function toResponse(record: RulesetRecord, entityTypes: Record<string, EntityTypeDef>): RulesetResponse {
  const state = anchorState(record, entityTypes);
  return {
    key: record.key,
    anchor: record.anchor === null || state === null ? null : { ...record.anchor, state },
    writeAccess: record.writeAccess,
  };
}

/** A storable key: the ruleset key rule. */
export function rulesetKeyError(key: string): string | null {
  return Key.safeParse(key).success
    ? null
    : `Invalid ruleset key '${key}'. Must match pattern ${RULESET_KEY_PATTERN.source} ` +
        `and be at most ${MAX_KEY_LENGTH} characters`;
}

export async function listRulesets(store: RuntimeStore): Promise<RulesetResponse[]> {
  const records = await store.rulesets().list();
  const entityTypes = await fullEntityTypes(store);
  return records.map((record) => toResponse(record, entityTypes));
}

/** The ruleset read fresh, with its anchor's state now. Unknown key -> not found. */
export async function readRuleset(key: string, store: RuntimeStore): Promise<RulesetResponse> {
  const record = await store.rulesets().get(key);
  if (record === null) throw new NotFoundError(`Ruleset '${key}' not found`);
  return toResponse(record, await fullEntityTypes(store));
}

/** Create or change (`PUT`, an idempotent upsert of the rules sent). The
 * level must be one of `LEVELS`; the anchor must be stored, under a type
 * of the full schema. */
export async function saveRuleset(key: string, body: RulesetWriteBody, store: RuntimeStore): Promise<RulesetResponse> {
  const keyError = rulesetKeyError(key);
  if (keyError !== null) throw new ValidationError(keyError);
  const { anchor, writeAccess } = RulesetWriteBody.parse(body);
  const entityTypes = await fullEntityTypes(store);
  const fields: Record<string, string> = {};
  const level = writeAccess === undefined ? undefined : Level.safeParse(writeAccess).data;
  if (writeAccess !== undefined && level === undefined) {
    fields.writeAccess = `Must be one of ${Level.options.join(", ")}, got '${writeAccess}'`;
  }
  if (anchor) {
    if (!Object.hasOwn(entityTypes, anchor.type)) {
      fields["anchor.type"] = `Entity type '${anchor.type}' not found`;
    } else if ((await store.getEntity(anchor.type, anchor.id)) === null) {
      fields["anchor.id"] = `Entity '${anchor.id}' of type '${anchor.type}' not found`;
    }
  }
  if (Object.keys(fields).length > 0) throw new ValidationError("Ruleset validation failed", { fields });
  return toResponse(await store.rulesets().save(key, { anchor, writeAccess: level }), entityTypes);
}

export async function deleteRuleset(key: string, store: RuntimeStore): Promise<void> {
  if (!(await store.rulesets().delete(key))) {
    throw new NotFoundError(`Ruleset '${key}' not found`);
  }
}

/**
 * The binding of a ruleset mount, checked on every request in the
 * not-found order ontology (the caller's `getRuntimeStore`), lens, ruleset.
 * The record is read fresh and never created; its write access is what
 * the entrance checks (`writeAccess.ts`).
 */
export async function readMountRuleset(lensKey: string, rulesetKey: string, store: RuntimeStore): Promise<RulesetRecord> {
  await loadSchema(lensKey, store);
  const record = await store.rulesets().get(rulesetKey);
  if (record === null) throw new NotFoundError(`Ruleset '${rulesetKey}' not found`);
  return record;
}

/** `get_anchor`: the ruleset through the lens, with the anchor entity's
 * name and its path (root first, ending with the entity, below the
 * nearest hidden ancestor). */
export async function getRulesetView(lensKey: string, rulesetKey: string, store: RuntimeStore): Promise<RulesetView> {
  const { key, writeAccess, anchor } = toResponse(
    await readMountRuleset(lensKey, rulesetKey, store),
    await fullEntityTypes(store),
  );
  if (anchor === null) return { key, writeAccess, anchor: null };
  const nothing = { type: null, id: null, name: null, path: [] };
  const deleted = { key, writeAccess, anchor: { ...nothing, state: "deleted" as const, visible: true } };
  if (anchor.state === "deleted") return deleted;
  if (!Object.hasOwn((await loadSchema(lensKey, store)).scoped.entityTypes, anchor.type)) {
    return { key, writeAccess, anchor: { ...nothing, state: "found", visible: false } };
  }
  let path;
  try {
    path = await getPath(lensKey, anchor.type, anchor.id, store);
  } catch (error) {
    // Deleted between the ruleset read and the path read.
    if (error instanceof NotFoundError) return deleted;
    throw error;
  }
  return { key, writeAccess, anchor: { ...path[path.length - 1]!, state: "found", visible: true, path } };
}
