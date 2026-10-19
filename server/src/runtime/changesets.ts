/**
 * Changesets: runtime writes of one lens, staged into a journal over any
 * time and persisted together by a commit. This module starts a changeset,
 * stages writes into it, reads it, unstages one write and discards it. REST
 * (`changesetRouter.ts`) is its entrance; like the write functions of
 * `service.ts`, every function takes the lens key and the anchor key of
 * the URL (null on the plain lens) first and the store last.
 *
 * - **Binding (V8 A, V17).** A changeset is bound to the lens it was
 *   started through and to the anchor key of that URL. Through another
 *   lens, or another anchor's URL, it is unknown; the plain lens URL
 *   reaches every changeset of its lens. Every unknown changeset (never
 *   existed, discarded, committed, expired, bound elsewhere) answers the
 *   one 404 "Changeset '<id>' not found".
 * - **Staging** (V18) is one short write per call (D2): it appends one
 *   journal row and nothing else; entities, relations and the search queue
 *   are untouched, and reads never see staged data (V16). Its checks, in
 *   order: the changeset; the anchor of the URL (dangling, or at an entity
 *   the lens hides: 409, as every v1 write; coverage is a commit rule,
 *   R10); the `prepare…` of the immediate write (`prepare.ts`: the type's
 *   404 and the same 422 field errors); the target of an update or delete
 *   (minted by a staged create still in the journal, or else read once:
 *   missing is the immediate write's 404); the cap (V25, R11). Relation
 *   ends and parent ends are not checked here.
 * - **Ids (V3).** A create mints its final id now, and with a parent
 *   relation the relation's id too; both are kept in the row.
 * - **Base (V10).** A staged update of a stored target records the stored
 *   values of exactly its patched keys, raw: an absent key stays absent,
 *   distinct from null, and a document value is kept as its hash.
 * - **Expiry (V24, R3).** A live changeset idle for 7 days is gone: checked
 *   on every access, where it is deleted and answers not found, and swept
 *   on start.
 */

import { createHash, randomUUID } from "node:crypto";

import { CoercionError, assertNoNulCharacter } from "../core/dataTypes.js";
import { ConflictError, NotFoundError, ValidationError } from "../core/exceptions.js";
import type {
  ChangesetRecord,
  ChangesetWriteRecord,
  NewChangesetWrite,
  RuntimeStore,
} from "../core/ports.js";
import type { PropertyDef } from "../core/schemas.js";
import { AnchorGuard } from "./anchorGuard.js";
import { cpLength } from "./codePoints.js";
import {
  prepareCreateEntity,
  prepareCreateRelation,
  prepareDeleteEntity,
  prepareDeleteRelation,
  prepareUpdateEntity,
  prepareUpdateRelation,
  type FieldErrors,
  type ParentRelationInput,
  type UpdateArgs,
} from "./prepare.js";
import { documentPropertyKeys } from "./readHelpers.js";
import { loadSchema, type LoadedSchema } from "./schemaCache.js";

type Row = Record<string, unknown>;

/** A live changeset idle this long is gone (V24). */
export const CHANGESET_IDLE_DAYS = 7;
/** The longest note, in characters (V32). */
export const MAX_NOTE_LENGTH = 1000;
/** The most staged writes one changeset holds (V25). */
export const MAX_STAGED_WRITES = 10_000;

const IDLE_MS = CHANGESET_IDLE_DAYS * 24 * 3_600_000;

/** One stageable write (V2), as the entrances hand it over: the payload of
 * the matching immediate write. */
export type StagedWrite =
  | { operation: "create_entity"; typeKey: string; properties: Row; parentRelation: ParentRelationInput | null }
  | { operation: "update_entity"; typeKey: string; id: string; properties: Row }
  | { operation: "delete_entity"; typeKey: string; id: string }
  | { operation: "create_relation"; typeKey: string; fromEntityId: string; toEntityId: string; properties: Row }
  | { operation: "update_relation"; typeKey: string; id: string; properties: Row }
  | { operation: "delete_relation"; typeKey: string; id: string };

export type StageableOperation = StagedWrite["operation"];

/** A changeset as every answer shows it. */
export interface ChangesetView {
  id: string;
  state: "live" | "submitted";
  version: number;
  note: string | null;
  /** The anchor key of the URL that started it; null on the plain lens. */
  anchor: string | null;
  writeCount: number;
  createdAt: Date;
  lastChangeAt: Date;
  submittedAt: Date | null;
}

/** One staged write as the read shows it. */
export interface StagedWriteView {
  seq: number;
  operation: string;
  /** The entity or relation type key. */
  type: string;
  /** The id a create minted, or the target of an update or delete. */
  id: string | null;
  /** The payload, as sent, after coercion. */
  arguments: Row;
  createdAt: Date;
}

/** The answer of a staged write (R4). */
export interface StagedAnswer {
  seq: number;
  id: string;
}

function notFound(id: string): NotFoundError {
  return new NotFoundError(`Changeset '${id}' not found`);
}

function toView(record: ChangesetRecord): ChangesetView {
  return {
    id: record.id,
    state: record.submittedAt === null ? "live" : "submitted",
    version: record.version,
    note: record.note,
    anchor: record.anchorKey,
    writeCount: record.writeCount,
    createdAt: record.createdAt,
    lastChangeAt: record.lastChangeAt,
    submittedAt: record.submittedAt,
  };
}

function toWriteView(write: ChangesetWriteRecord): StagedWriteView {
  return {
    seq: write.seq,
    operation: write.operation,
    type: write.typeKey,
    id: write.mintedId ?? write.targetId,
    arguments: write.arguments,
    createdAt: write.createdAt,
  };
}

/** Live changesets last changed before this are expired. */
function expiryCutoff(): Date {
  return new Date(Date.now() - IDLE_MS);
}

/** A valid note, or null; over the cap, or holding a NUL, is a 422 (V32). */
function validNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  let fault: string | null = null;
  if (cpLength(note) > MAX_NOTE_LENGTH) {
    fault = `At most ${MAX_NOTE_LENGTH} characters, got ${cpLength(note)}`;
  } else {
    try {
      assertNoNulCharacter(note, "note");
    } catch (error) {
      if (!(error instanceof CoercionError)) throw error;
      fault = error.message;
    }
  }
  if (fault !== null) {
    throw new ValidationError("Changeset validation failed", { fields: { note: fault } });
  }
  return note;
}

/**
 * The changeset through its binding: another lens, or another anchor's
 * URL, is not found. An expired one is deleted (with every other expired
 * one of the ontology) and is not found either.
 */
async function loadChangeset(
  loaded: LoadedSchema,
  anchorKey: string | null,
  id: string,
  store: RuntimeStore,
): Promise<ChangesetRecord> {
  const changesets = store.changesets();
  const record = await changesets.get(id, loaded.scoped.lensId, anchorKey);
  if (record === null) throw notFound(id);
  const cutoff = expiryCutoff();
  if (record.submittedAt === null && record.lastChangeAt < cutoff) {
    await changesets.sweep(cutoff);
    throw notFound(id);
  }
  return record;
}

/** Start a changeset bound to the lens and to the anchor key of the URL
 * (V17). Unknown lens or anchor is not found, in that order. */
export async function startChangeset(
  lensKey: string,
  anchorKey: string | null,
  note: string | null | undefined,
  store: RuntimeStore,
): Promise<ChangesetView> {
  const loaded = await loadSchema(lensKey, store);
  if (anchorKey !== null && (await store.anchors().getAnchor(anchorKey)) === null) {
    throw new NotFoundError(`Anchor '${anchorKey}' not found`);
  }
  const valid = validNote(note);
  const changesets = store.changesets();
  await changesets.sweep(expiryCutoff());
  const record = await changesets.start({ id: randomUUID(), lensId: loaded.scoped.lensId, anchorKey, note: valid });
  return toView(record);
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

function refuseOn(errors: FieldErrors): void {
  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Instance validation failed", { fields: errors });
  }
}

/** The coerced values of the keys the caller sent; a key whose coercion
 * left nothing (a null on create, without a default) is left out. */
function sent(coerced: Row, body: Row): Row {
  const values: Row = {};
  for (const key of Object.keys(body)) {
    if (Object.hasOwn(coerced, key)) values[key] = coerced[key];
  }
  return values;
}

/** The coerced patch of an update: each changed key, null removing it. */
function patchOf(write: UpdateArgs): Row {
  const keys = "changedKeys" in write.change ? write.change.changedKeys : [];
  return Object.fromEntries(
    keys.map((key) => [key, Object.hasOwn(write.setProperties, key) ? write.setProperties[key] : null]),
  );
}

/** How a document value is kept in a base: its hash, not its text. */
export function documentHash(text: string): Row {
  return { sha256: createHash("sha256").update(text, "utf8").digest("hex") };
}

/**
 * The base of a staged update (V10): the stored values of exactly `keys`,
 * raw as the store reads them without definitions. A key the target does
 * not hold stays absent, distinct from a stored null; a document value is
 * its hash (`documentHash`).
 */
export function baseOf(stored: Row, keys: string[], propertyDefs: Record<string, PropertyDef>): Row {
  const documents = documentPropertyKeys(propertyDefs);
  const base: Row = {};
  for (const key of keys) {
    if (!Object.hasOwn(stored, key)) continue;
    const value = stored[key];
    base[key] = documents.has(key) && typeof value === "string" ? documentHash(value) : value;
  }
  return base;
}

/** Whether `id` was minted by a staged create of this kind and type that
 * is still in the journal (V18). */
async function mintedInJournal(
  changesetId: string,
  create: "create_entity" | "create_relation",
  typeKey: string,
  id: string,
  store: RuntimeStore,
): Promise<boolean> {
  const row = await store.changesets().findMinted(changesetId, id);
  return row !== null && row.operation === create && row.typeKey === typeKey;
}

/** The stored target of an update or delete, read once; null when a staged
 * create minted it. Missing is the immediate write's 404. */
async function target(
  changesetId: string,
  kind: "entity" | "relation",
  typeKey: string,
  id: string,
  store: RuntimeStore,
): Promise<Row | null> {
  if (await mintedInJournal(changesetId, kind === "entity" ? "create_entity" : "create_relation", typeKey, id, store)) {
    return null;
  }
  const stored = kind === "entity" ? await store.getEntity(typeKey, id) : await store.getRelation(typeKey, id);
  if (stored === null) {
    throw new NotFoundError(`${kind === "entity" ? "Entity" : "Relation"} '${id}' not found`);
  }
  return stored;
}

/** The journal row of one staged write, after its checks. */
async function journalRow(
  loaded: LoadedSchema,
  changesetId: string,
  write: StagedWrite,
  store: RuntimeStore,
): Promise<NewChangesetWrite> {
  const row = { operation: write.operation, typeKey: write.typeKey, mintedId: null, targetId: null, base: null };
  switch (write.operation) {
    case "create_entity": {
      const ids = { entityId: randomUUID(), relationId: randomUUID() };
      const { errors, write: prepared } = prepareCreateEntity(
        loaded,
        write.typeKey,
        write.properties,
        write.parentRelation,
        ids,
      );
      refuseOn(errors);
      const input = write.parentRelation;
      const parent = prepared.parent;
      return {
        ...row,
        mintedId: ids.entityId,
        arguments: {
          properties: sent(prepared.entity.properties, write.properties),
          parentRelation:
            input === null || parent === null
              ? null
              : {
                  type: input.type,
                  parentId: input.parentId,
                  properties: sent(parent.relation.properties, input.properties ?? {}),
                },
          relationId: input === null ? null : ids.relationId,
        },
      };
    }
    case "update_entity": {
      const { errors, write: prepared } = prepareUpdateEntity(loaded, write.typeKey, write.id, write.properties);
      refuseOn(errors);
      const patch = prepared === null ? {} : patchOf(prepared);
      const stored = await target(changesetId, "entity", write.typeKey, write.id, store);
      const defs = loaded.full.entityTypes[write.typeKey]?.properties ?? {};
      return {
        ...row,
        targetId: write.id,
        arguments: { properties: patch },
        base: stored === null ? null : baseOf(stored, Object.keys(patch), defs),
      };
    }
    case "delete_entity": {
      prepareDeleteEntity(loaded, write.typeKey, write.id);
      await target(changesetId, "entity", write.typeKey, write.id, store);
      return { ...row, targetId: write.id, arguments: {} };
    }
    case "create_relation": {
      const relationId = randomUUID();
      const { errors, write: prepared } = prepareCreateRelation(
        loaded,
        write.typeKey,
        write.fromEntityId,
        write.toEntityId,
        write.properties,
        relationId,
      );
      refuseOn(errors);
      return {
        ...row,
        mintedId: relationId,
        arguments: {
          fromEntityId: write.fromEntityId,
          toEntityId: write.toEntityId,
          properties: sent(prepared.properties, write.properties),
        },
      };
    }
    case "update_relation": {
      const { errors, write: prepared } = prepareUpdateRelation(loaded, write.typeKey, write.id, write.properties);
      refuseOn(errors);
      const patch = prepared === null ? {} : patchOf(prepared);
      const stored = await target(changesetId, "relation", write.typeKey, write.id, store);
      const defs = loaded.full.relationTypes[write.typeKey]?.properties ?? {};
      return {
        ...row,
        targetId: write.id,
        arguments: { properties: patch },
        base: stored === null ? null : baseOf(stored, Object.keys(patch), defs),
      };
    }
    case "delete_relation": {
      prepareDeleteRelation(loaded, write.typeKey, write.id);
      await target(changesetId, "relation", write.typeKey, write.id, store);
      return { ...row, targetId: write.id, arguments: {} };
    }
  }
}

/**
 * Stage one write: its checks (see the header), then one journal row.
 * Answers its seq and the id it names: the minted id of a create, the
 * target of an update or delete. A full changeset, or one a commit holds,
 * is a 409.
 */
export async function stage(
  lensKey: string,
  anchorKey: string | null,
  changesetId: string,
  write: StagedWrite,
  store: RuntimeStore,
): Promise<StagedAnswer> {
  const loaded = await loadSchema(lensKey, store);
  const changeset = await loadChangeset(loaded, anchorKey, changesetId, store);
  // Dangling, or at an entity the lens hides: refused as every v1 write.
  await AnchorGuard.open(anchorKey, loaded, store);

  const row = await journalRow(loaded, changeset.id, write, store);
  if (changeset.writeCount >= MAX_STAGED_WRITES) {
    throw new ConflictError(`Changeset '${changesetId}' is full: at most ${MAX_STAGED_WRITES} staged writes`);
  }
  const seq = await store.changesets().append(changeset.id, row);
  if (seq === null) throw notFound(changesetId);
  return { seq, id: (row.mintedId ?? row.targetId)! };
}

// ---------------------------------------------------------------------------
// Read, unstage, discard
// ---------------------------------------------------------------------------

/** The changeset and one page of its writes by seq (R7). */
export async function getChangeset(
  lensKey: string,
  anchorKey: string | null,
  changesetId: string,
  offset: number,
  limit: number,
  store: RuntimeStore,
): Promise<ChangesetView & { offset: number; limit: number; writes: StagedWriteView[] }> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, anchorKey, changesetId, store);
  const writes = await store.changesets().page(record.id, offset, limit);
  return { ...toView(record), offset, limit, writes: writes.map(toWriteView) };
}

/** Take one staged write out by seq. Writes that depend on it stay; the
 * commit's checks flag them (V6). Allowed on a dangling anchor. */
export async function unstage(
  lensKey: string,
  anchorKey: string | null,
  changesetId: string,
  seq: number,
  store: RuntimeStore,
): Promise<void> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, anchorKey, changesetId, store);
  if (!(await store.changesets().unstage(record.id, seq))) {
    throw new NotFoundError(`Staged write ${seq} not found in changeset '${changesetId}'`);
  }
}

/** Delete a live changeset and its journal. A submitted one is refused
 * (V38); the store deletes a live one only, so a submit landing after the
 * read is refused too. */
export async function discardChangeset(
  lensKey: string,
  anchorKey: string | null,
  changesetId: string,
  store: RuntimeStore,
): Promise<void> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, anchorKey, changesetId, store);
  const changesets = store.changesets();
  if (record.submittedAt === null && (await changesets.discard(record.id))) return;
  if ((await changesets.get(record.id, loaded.scoped.lensId, anchorKey)) === null) throw notFound(changesetId);
  throw new ConflictError(`Changeset '${changesetId}' is submitted; unsubmit it first`);
}
