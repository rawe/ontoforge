/**
 * Changesets: runtime writes of one lens, staged into a journal over any
 * time and persisted together by a commit. This module starts a changeset,
 * stages writes into it, lists and reads it, unstages one write, submits
 * and unsubmits it, discards it and commits it. REST
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
 * - **Staging** (V18) is one short write per call (D2): it appends to the
 *   journal and nothing else; entities, relations and the search queue
 *   are untouched, and reads never see staged data (V16). Its checks, in
 *   order: the changeset; the anchor of the URL (dangling, or at an entity
 *   the lens hides: 409, as every v1 write; coverage is a commit rule,
 *   R10); the `prepare…` of the immediate write (`prepare.ts`: the type's
 *   404 and the same 422 field errors); the target of an update or delete
 *   (minted by a staged create still in the journal, or else read once:
 *   missing is the immediate write's 404); the caps on writes and bytes
 *   (V25, R11, `writeBytes`), counted over every row the write
 *   appends. Relation ends are not checked here.
 * - **Ids (V3).** A create mints its final id now. A create with a parent
 *   relation is staged as two rows, the entity's create and then the
 *   relation's `create_relation`, each with its own id.
 * - **Before (V10).** A staged update of a stored target records the
 *   stored values of exactly its patched keys as its `before`, raw: an
 *   absent key stays absent, distinct from null, and a document value is
 *   kept as its hash and its length. Drift is the stored values now
 *   (`current`) differing from it, a document by its hash.
 * - **Expiry (V24, R3).** A draft changeset idle for 7 days is gone: checked
 *   on every access, where it is deleted and answers not found, and swept
 *   on start and on list. A submitted changeset never expires.
 * - **Write access** is checked by the entrances (`writeAccess.ts`), on
 *   the URL's ruleset, before any function here runs.
 * - **Lifecycle (V7, V38).** Submit freezes a draft changeset and hands it
 *   over with a note, after the lock-free pass (V5 d) and a compare-and-set
 *   on the version the pass saw (V40). While submitted, stage, unstage and
 *   discard are 409s, decided in the store's own statement; unsubmit (a
 *   note is required, R14) makes it a draft again, and commit is the
 *   approval. A rejected commit leaves it as it was (R6).
 * - **Review (V41).** The list and the reads apply the lens as it is now:
 *   a type, property or name the lens hides is never shown. The review
 *   read shows no staged arguments and stubs every document value; the
 *   staged document read returns the text the last staged write of a
 *   document property sets, and the staged entity read one entity as a
 *   commit would leave it, beside its own staged writes.
 * - **Commit (D3, V1 B).** Before BEGIN, holding nothing: the schema, the
 *   changeset and the search context are loaded, and the lock-free pass
 *   (V19) runs; any fault it finds rejects here. Then one transaction on
 *   one connection: the commit lock and the changeset row (V12), the
 *   version check (V40), every stored target `FOR UPDATE` with drift
 *   re-checked, the anchor read fresh; the replay of the journal by seq
 *   through the store's own write methods with their search work (V20,
 *   V23); commit validation over the end state (V21); the journal
 *   deleted, COMMIT. Any failure rolls all of it back; a rejection (422,
 *   the violations by seq, V22) then refreshes the last change and keeps
 *   the version (R6). One commit runs at a time in one process (V26,
 *   R5).
 */

import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { CoercionError, assertNoNulCharacter } from "../core/dataTypes.js";
import { settings } from "../config.js";
import { ConflictError, NotFoundError, ValidationError } from "../core/exceptions.js";
import type {
  ChangesetRecord,
  ChangesetWriteRecord,
  NewChangesetWrite,
  ParentLink,
  RuntimeStore,
  SearchWritePlan,
} from "../core/ports.js";
import type { ParentEnd, PropertyDef } from "../core/schemas.js";
import { planSearchWrite, type SearchChange } from "../core/searchDependencies.js";
import { AnchorGuard, changesetAnchorRefusal, hierarchyOf } from "./anchorGuard.js";
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
import { docLengthKey, documentPropertyKeys, filterEntityProperties, stubDocumentProperties } from "./readHelpers.js";
import { loadSchema, loadSearchContext, type LoadedSchema, type SearchContext } from "./schemaCache.js";
import { documentSlice, endpointTypeMessage, parentReadings, type EndRole } from "./service.js";

type Row = Record<string, unknown>;

/** A draft changeset idle this long is gone (V24). */
export const CHANGESET_IDLE_DAYS = 7;
/** The longest note, in characters (V32). */
export const MAX_NOTE_LENGTH = 1000;
/** The most staged writes one changeset holds (V25). */
export const MAX_STAGED_WRITES = 10_000;

/** The size a staged write counts toward the byte cap
 * (`CHANGESET_MAX_BYTES`): the UTF-8 bytes of its arguments and its
 * before as JSON, document text included. */
export function writeBytes(write: NewChangesetWrite): number {
  const before = write.before === null ? 0 : Buffer.byteLength(JSON.stringify(write.before));
  return Buffer.byteLength(JSON.stringify(write.arguments)) + before;
}

const IDLE_MS = CHANGESET_IDLE_DAYS * 24 * 3_600_000;

/** One stageable write (V2), as the entrances hand it over: the values of
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
  state: "draft" | "submitted";
  version: number;
  note: string | null;
  /** The anchor key of the URL that started it; null on the plain lens. */
  anchor: string | null;
  writeCount: number;
  createdAt: Date;
  lastChangeAt: Date;
  submittedAt: Date | null;
}

/** One end of a staged relation write. */
export interface EndView {
  id: string;
  /** Its name through the lens: the stored name when stored, staged when a create of
   * this changeset mints it; null when the lens shows none. */
  name: string | null;
}

/** A fault the lock-free pass finds on a staged write (V19). */
export interface Marker {
  kind: string;
  message: string;
}

/**
 * One staged write as the review read shows it, through the lens as it is
 * now (V41). A write whose type the lens no longer shows keeps only its
 * seq, operation, time and markers.
 */
export interface StagedWriteView {
  seq: number;
  operation: string;
  /** The entity or relation type key; null when the lens hides it. */
  type: string | null;
  /** The id a create minted, or the target of an update or delete. */
  id: string | null;
  createdAt: Date;
  /** Entity writes: the target's name. */
  name?: string | null;
  /** Relation writes: the two ends. */
  from?: EndView | null;
  to?: EndView | null;
  /** Updates of a stored target: the stored values of the patched keys as
   * they were when it was staged, null for a key the target lacked. */
  before: Row | null;
  /** Updates of a stored target: the stored values of the patched keys
   * now; null when the target is gone. Drift is `current` ≠ `before`. */
  current: Row | null;
  /** Creates and updates: the staged values. */
  after: Row | null;
  /** The lock-free pass's faults on this write: drift, dangling, not
   * visible, missing, or a value the lens no longer accepts. */
  markers: Marker[];
}

/** A changeset as the list shows it (V17, V41). */
export interface ChangesetListItem {
  id: string;
  state: "draft" | "submitted";
  version: number;
  note: string | null;
  anchor: string | null;
  /** The number of staged writes, as the read shows it. */
  writeCount: number;
  /** The staged writes per operation. */
  operations: Record<string, number>;
  /** The type keys the staged writes name that the lens shows, sorted. */
  types: string[];
  /** How many type keys the staged writes name that the lens no longer
   * shows; they are left out of `types`. */
  notVisible: number;
  createdAt: Date;
  lastChangeAt: Date;
  submittedAt: Date | null;
}

/** The answer of a staged write (R4). */
export interface StagedAnswer {
  seq: number;
  id: string;
  /** A create with a parent relation: the relation's write, staged next. */
  relation?: { seq: number; id: string };
}

function notFound(id: string): NotFoundError {
  return new NotFoundError(`Changeset '${id}' not found`);
}

/** The 409 of stage, unstage and discard while submitted (V18, V38). */
function isSubmitted(id: string): ConflictError {
  return new ConflictError(`Changeset '${id}' is submitted; unsubmit it first`);
}

function toView(record: ChangesetRecord): ChangesetView {
  return {
    id: record.id,
    state: record.submittedAt === null ? "draft" : "submitted",
    version: record.version,
    note: record.note,
    anchor: record.rulesetKey,
    writeCount: record.writeCount,
    createdAt: record.createdAt,
    lastChangeAt: record.lastChangeAt,
    submittedAt: record.submittedAt,
  };
}

/** Draft changesets last changed before this are expired. */
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

/** After the store refused to change a draft changeset: gone is not
 * found, submitted is the 409; otherwise null. */
async function refusalOf(
  loaded: LoadedSchema,
  anchorKey: string | null,
  id: string,
  store: RuntimeStore,
): Promise<Error | null> {
  const record = await store.changesets().get(id, loaded.scoped.lensId, anchorKey);
  if (record === null) return notFound(id);
  return record.submittedAt === null ? null : isSubmitted(id);
}

/** An anchor key of the URL that names no anchor is not found. */
async function checkAnchorExists(anchorKey: string | null, store: RuntimeStore): Promise<void> {
  if (anchorKey !== null && (await store.rulesets().get(anchorKey)) === null) {
    throw new NotFoundError(`Anchor '${anchorKey}' not found`);
  }
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
  await checkAnchorExists(anchorKey, store);
  const valid = validNote(note);
  const changesets = store.changesets();
  await changesets.sweep(expiryCutoff());
  const record = await changesets.start({ id: randomUUID(), lensId: loaded.scoped.lensId, rulesetKey: anchorKey, note: valid });
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

/** How a document value is kept in a staged update's `before`: its hash
 * and its length in characters, not its text. */
export function recordedDocument(text: string): Row {
  return { sha256: createHash("sha256").update(text, "utf8").digest("hex"), length: cpLength(text) };
}

/**
 * The stored values of exactly `keys` as a staged update records them in
 * its `before` and drift compares them (V10): raw as the store reads them
 * without definitions. A key the target does not hold stays absent,
 * distinct from a stored null; a document value is its hash and length
 * (`recordedDocument`).
 */
export function recordedValues(stored: Row, keys: string[], propertyDefs: Record<string, PropertyDef>): Row {
  const documents = documentPropertyKeys(propertyDefs);
  const values: Row = {};
  for (const key of keys) {
    if (!Object.hasOwn(stored, key)) continue;
    const value = stored[key];
    values[key] = documents.has(key) && typeof value === "string" ? recordedDocument(value) : value;
  }
  return values;
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

/** The journal rows of one staged write, after its checks: one row, or
 * for a create with a parent relation two, the entity's create and then
 * the parent relation's, the row a staged `create_relation` of it gets. */
async function journalRows(
  loaded: LoadedSchema,
  changesetId: string,
  write: StagedWrite,
  store: RuntimeStore,
): Promise<NewChangesetWrite[]> {
  const row = { operation: write.operation, typeKey: write.typeKey, mintedId: null, targetId: null, before: null };
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
      const entity = {
        ...row,
        mintedId: ids.entityId,
        arguments: { properties: sent(prepared.entity.properties, write.properties) },
      };
      const input = write.parentRelation;
      if (input === null || prepared.parent === null) return [entity];
      // Oriented by the relation type's parent end.
      const r = prepared.parent.relation;
      return [
        entity,
        {
          operation: "create_relation",
          typeKey: input.type,
          mintedId: ids.relationId,
          targetId: null,
          before: null,
          arguments: {
            fromEntityId: r.fromEntityId,
            toEntityId: r.toEntityId,
            properties: sent(r.properties, input.properties ?? {}),
          },
        },
      ];
    }
    case "update_entity": {
      const { errors, write: prepared } = prepareUpdateEntity(loaded, write.typeKey, write.id, write.properties);
      refuseOn(errors);
      const patch = prepared === null ? {} : patchOf(prepared);
      const stored = await target(changesetId, "entity", write.typeKey, write.id, store);
      const defs = loaded.full.entityTypes[write.typeKey]?.properties ?? {};
      return [
        {
          ...row,
          targetId: write.id,
          arguments: { properties: patch },
          before: stored === null ? null : recordedValues(stored, Object.keys(patch), defs),
        },
      ];
    }
    case "delete_entity": {
      prepareDeleteEntity(loaded, write.typeKey, write.id);
      await target(changesetId, "entity", write.typeKey, write.id, store);
      return [{ ...row, targetId: write.id, arguments: {} }];
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
      return [
        {
          ...row,
          mintedId: relationId,
          arguments: {
            fromEntityId: write.fromEntityId,
            toEntityId: write.toEntityId,
            properties: sent(prepared.properties, write.properties),
          },
        },
      ];
    }
    case "update_relation": {
      const { errors, write: prepared } = prepareUpdateRelation(loaded, write.typeKey, write.id, write.properties);
      refuseOn(errors);
      const patch = prepared === null ? {} : patchOf(prepared);
      const stored = await target(changesetId, "relation", write.typeKey, write.id, store);
      const defs = loaded.full.relationTypes[write.typeKey]?.properties ?? {};
      return [
        {
          ...row,
          targetId: write.id,
          arguments: { properties: patch },
          before: stored === null ? null : recordedValues(stored, Object.keys(patch), defs),
        },
      ];
    }
    case "delete_relation": {
      prepareDeleteRelation(loaded, write.typeKey, write.id);
      await target(changesetId, "relation", write.typeKey, write.id, store);
      return [{ ...row, targetId: write.id, arguments: {} }];
    }
  }
}

/**
 * Stage one write: its checks (see the header), then its journal rows,
 * all or none. Answers the seq and the id of its first row: the minted id
 * of a create, the target of an update or delete; a create with a parent
 * relation adds the relation's seq and id. A full changeset, or one a
 * commit holds, is a 409.
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
  if (changeset.submittedAt !== null) throw isSubmitted(changesetId);
  // Dangling, or at an entity the lens hides: refused as every v1 write.
  await AnchorGuard.checkStaging(anchorKey, loaded, store);

  const rows = await journalRows(loaded, changeset.id, write, store);
  if (changeset.writeCount + rows.length > MAX_STAGED_WRITES) {
    throw new ConflictError(`Changeset '${changesetId}' is full: at most ${MAX_STAGED_WRITES} staged writes`);
  }
  const writes = rows.map((row) => ({ write: row, bytes: writeBytes(row) }));
  const bytes = writes.reduce((sum, { bytes }) => sum + bytes, 0);
  const maxBytes = settings.CHANGESET_MAX_BYTES;
  if ((await store.changesets().stagedBytes(changeset.id)) + bytes > maxBytes) {
    throw new ConflictError(`Changeset '${changesetId}' is full: at most ${maxBytes} bytes of staged writes`);
  }
  // The store appends to a draft changeset only: a submit since the read
  // is refused here.
  const seqs = await store.changesets().append(changeset.id, writes);
  if (seqs === null) throw (await refusalOf(loaded, anchorKey, changeset.id, store)) ?? notFound(changesetId);
  const [entity, relation] = rows;
  const answer: StagedAnswer = { seq: seqs[0]!, id: (entity!.mintedId ?? entity!.targetId)! };
  if (relation !== undefined) answer.relation = { seq: seqs[1]!, id: relation.mintedId! };
  return answer;
}

// ---------------------------------------------------------------------------
// Read, unstage, discard
// ---------------------------------------------------------------------------

/**
 * The review read (R7, V41): the changeset and one page of its writes by
 * seq, each with names resolved, `before`, `current` and `after`, and
 * the markers the lock-free pass finds on it. The page's writes are
 * judged alone, as `getStagedEntity` judges an entity's: a write's
 * markers depend on nothing else in the journal but which creates still
 * in it minted the ids it names (`mintedFor`).
 */
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
  const minted = await mintedFor(record.id, writes, store);
  const stored = await storedRows(loaded, writes, minted, true, store);
  const { faults } = passFaults(loaded, writes, minted, stored);
  return { ...toView(record), offset, limit, writes: reviewPage(loaded, writes, { faults, minted }, stored) };
}

/**
 * The text a commit of this changeset would leave in one document
 * property: the value the last staged write setting it sets (a create or
 * an update of that entity, an entity this changeset creates included),
 * sliced as the document read slices (`documentSlice`). A null set is the
 * empty text. Through the lens as every review read: a type or property it
 * hides is not found, and so is a property no staged write sets, or one of
 * an entity a later staged write deletes (ids are final: nothing re-creates
 * it).
 */
export async function getStagedDocument(
  lensKey: string,
  anchorKey: string | null,
  changesetId: string,
  entityTypeKey: string,
  entityId: string,
  propertyKey: string,
  offset: number,
  limit: number | null,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, anchorKey, changesetId, store);
  const type = loaded.scoped.entityTypes[entityTypeKey];
  if (type === undefined) throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  if (type.properties[propertyKey]?.dataType !== "document") {
    throw new NotFoundError(`Document property '${propertyKey}' not found on entity type '${entityTypeKey}'`);
  }

  let staged: { value: unknown } | null = null;
  let deleted = false;
  for (let at = 0; ; at += REPLAY_PAGE) {
    const page = await store.changesets().page(record.id, at, REPLAY_PAGE);
    for (const write of page) {
      if (write.typeKey !== entityTypeKey) continue;
      const sets =
        (write.operation === "create_entity" && write.mintedId === entityId) ||
        (write.operation === "update_entity" && write.targetId === entityId);
      const properties = (write.arguments.properties ?? {}) as Row;
      if (sets && Object.hasOwn(properties, propertyKey)) {
        staged = { value: properties[propertyKey] };
        deleted = false;
      } else if (write.operation === "delete_entity" && write.targetId === entityId) {
        deleted = true;
      }
    }
    if (page.length < REPLAY_PAGE) break;
  }
  if (staged !== null && deleted) {
    throw new NotFoundError(
      `Changeset '${changesetId}' deletes entity '${entityId}': a commit leaves no '${propertyKey}'`,
    );
  }
  if (staged === null) {
    throw new NotFoundError(
      `No staged write of changeset '${changesetId}' sets '${propertyKey}' of entity '${entityId}'`,
    );
  }
  return documentSlice(propertyKey, typeof staged.value === "string" ? staged.value : "", offset, limit);
}

/** One entity as a commit of this changeset would leave it, and the
 * staged writes on it. */
export interface StagedEntityView {
  /** The stored entity, or the one this changeset creates, through the
   * lens, with the staged writes on it folded in by seq. */
  entity: Row;
  /** Whether its last staged write deletes it. */
  deleted: boolean;
  /** Its own staged writes (create, update, delete) as the review shows them. */
  writes: StagedWriteView[];
}

/**
 * One entity as a commit of this changeset would leave it: the stored
 * entity, or the one a staged create mints, with this changeset's creates
 * and updates of it folded in by seq (a null removes a key) and no
 * defaults applied (the commit applies them), as the entity read shows it
 * through the lens, documents as stubs; `deleted` when its last staged
 * write is a delete. Beside it, those writes as the review read shows
 * them, with the lock-free pass's markers judged on them alone: they
 * depend on nothing else in the journal. Relation writes naming the
 * entity are not among them. Not found: a type the lens hides, or an
 * entity neither stored nor created by this changeset.
 */
export async function getStagedEntity(
  lensKey: string,
  anchorKey: string | null,
  changesetId: string,
  entityTypeKey: string,
  entityId: string,
  store: RuntimeStore,
): Promise<StagedEntityView> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, anchorKey, changesetId, store);
  const type = loaded.scoped.entityTypes[entityTypeKey];
  if (type === undefined) throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);

  const writes = (await store.changesets().writesOn(record.id, entityId)).filter(
    (write) => write.operation.endsWith("_entity") && write.typeKey === entityTypeKey,
  );
  const stored = await store.getEntity(entityTypeKey, entityId);
  const minted = mintedBy(writes);
  if (stored === null && !minted.has(entityId)) throw new NotFoundError(`Entity '${entityId}' not found`);

  const entity: Row = stored === null ? { _id: entityId, _entityTypeKey: entityTypeKey } : { ...stored };
  let deleted = false;
  for (const write of writes) {
    deleted = write.operation === "delete_entity";
    for (const [key, value] of Object.entries((write.arguments.properties ?? {}) as Row)) {
      // A staged document is measured afresh, not by the stored length.
      delete entity[docLengthKey(key)];
      if (value === null) delete entity[key];
      else entity[key] = value;
    }
  }

  const rows: Stored = {
    entities: new Map(stored === null ? [] : [[entityId, stored] as const]),
    relations: new Map(),
  };
  const { faults } = passFaults(loaded, writes, minted, rows);
  return {
    entity: filterEntityProperties(entity, type),
    deleted,
    writes: reviewPage(loaded, writes, { faults, minted }, rows),
  };
}

/**
 * The lens's changesets (V17): through the plain lens URL every one, through
 * an anchored URL only its anchor's; submitted first, then by last change.
 * Expired draft changesets are swept first (R3). `types` applies the lens as
 * it is now (V41).
 */
export async function listChangesets(
  lensKey: string,
  anchorKey: string | null,
  store: RuntimeStore,
): Promise<ChangesetListItem[]> {
  const loaded = await loadSchema(lensKey, store);
  await checkAnchorExists(anchorKey, store);
  const changesets = store.changesets();
  await changesets.sweep(expiryCutoff());
  const lens = loaded.scoped;
  const shown = (key: string): boolean => Object.hasOwn(lens.entityTypes, key) || Object.hasOwn(lens.relationTypes, key);
  return (await changesets.list(lens.lensId, anchorKey)).map((summary) => {
    const types = summary.typeKeys.filter(shown);
    return {
      id: summary.id,
      state: summary.submittedAt === null ? "draft" : "submitted",
      version: summary.version,
      note: summary.note,
      anchor: summary.rulesetKey,
      writeCount: summary.writeCount,
      operations: summary.operations,
      types,
      notVisible: summary.typeKeys.length - types.length,
      createdAt: summary.createdAt,
      lastChangeAt: summary.lastChangeAt,
      submittedAt: summary.submittedAt,
    };
  });
}

/** How many changesets a lens delete takes with it (V42, R8), counted
 * before the delete; an expired draft changeset is gone already. */
export async function lensChangesetCount(lensId: string, store: RuntimeStore): Promise<number> {
  const cutoff = expiryCutoff();
  const summaries = await store.changesets().list(lensId, null);
  return summaries.filter((summary) => summary.submittedAt !== null || summary.lastChangeAt >= cutoff).length;
}

// ---------------------------------------------------------------------------
// Submit, unsubmit
// ---------------------------------------------------------------------------

/**
 * Submit a draft changeset (V7, V5 d): freeze it and hand it over, with the
 * note given (absent, the note stays). Already submitted, or an anchored
 * changeset whose anchor is dangling or at an entity the lens hides, is a
 * 409. The lock-free pass runs with no lock and no transaction; its faults
 * are a 422 and the changeset stays a draft. Clean, a compare-and-set on the
 * version the pass saw (V40): a change meanwhile is a 409.
 */
export async function submitChangeset(
  lensKey: string,
  anchorKey: string | null,
  changesetId: string,
  note: string | null | undefined,
  store: RuntimeStore,
): Promise<ChangesetView> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, anchorKey, changesetId, store);
  if (record.submittedAt !== null) throw new ConflictError(`Changeset '${changesetId}' is already submitted`);
  const valid = validNote(note);
  if (record.rulesetKey !== null) {
    // The stored anchor, whatever URL the call came through. A deleted one
    // is left to the commit ("anchor gone").
    const anchor = await store.rulesets().get(record.rulesetKey);
    const refusal = anchor === null ? null : changesetAnchorRefusal(record.rulesetKey, anchor, loaded);
    if (refusal !== null) throw new ConflictError(refusal);
  }
  const pass = await lockFreePass(loaded, record.id, store);
  if (pass.faults.length > 0) {
    throw violationsError("The changeset was not submitted; it stays a draft", pass.faults);
  }
  const submitted = await store.changesets().submit(record.id, record.version, valid ?? record.note);
  if (submitted === null) {
    if ((await store.changesets().get(record.id, loaded.scoped.lensId, anchorKey)) === null) throw notFound(changesetId);
    throw new ConflictError(`Changeset '${changesetId}' changed during the submit; try again`);
  }
  return toView(submitted);
}

/**
 * A submitted changeset back to draft (V7, R14), through any URL that
 * reaches it, a dangling anchor's included. The note is required: it
 * replaces the stored one. A draft changeset is a 409.
 */
export async function unsubmitChangeset(
  lensKey: string,
  anchorKey: string | null,
  changesetId: string,
  note: string | null | undefined,
  store: RuntimeStore,
): Promise<ChangesetView> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, anchorKey, changesetId, store);
  const valid = validNote(note);
  if (valid === null || valid.trim() === "") {
    throw new ValidationError("Changeset validation failed", { fields: { note: "A note is required to unsubmit" } });
  }
  const notSubmitted = new ConflictError(`Changeset '${changesetId}' is not submitted`);
  if (record.submittedAt === null) throw notSubmitted;
  const draft = await store.changesets().unsubmit(record.id, valid);
  if (draft === null) {
    if ((await store.changesets().get(record.id, loaded.scoped.lensId, anchorKey)) === null) throw notFound(changesetId);
    throw notSubmitted;
  }
  return toView(draft);
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
  if (record.submittedAt !== null) throw isSubmitted(changesetId);
  if (!(await store.changesets().unstage(record.id, seq))) {
    // Refused by the store: gone, submitted since the read, or no such seq.
    throw (
      (await refusalOf(loaded, anchorKey, record.id, store)) ??
      new NotFoundError(`Staged write ${seq} not found in changeset '${changesetId}'`)
    );
  }
}

/** Delete a draft changeset and its journal. A submitted one is refused
 * (V38); the store deletes a draft one only, so a submit landing after the
 * read is refused too. */
export async function discardChangeset(
  lensKey: string,
  anchorKey: string | null,
  changesetId: string,
  store: RuntimeStore,
): Promise<void> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, anchorKey, changesetId, store);
  if (record.submittedAt === null && (await store.changesets().discard(record.id))) return;
  throw (await refusalOf(loaded, anchorKey, record.id, store)) ?? notFound(changesetId);
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/** At most this many commits run at once in one process (V26, R5). */
export const MAX_RUNNING_COMMITS = 1;
/** A rejection names at most this many violations (V21). */
export const MAX_VIOLATIONS = 100;
/** The journal is replayed in pages of this many writes. */
const REPLAY_PAGE = 500;

let runningCommits = 0;

/** One reason a commit is rejected, on the staged write it concerns. */
export interface Violation {
  seq: number;
  kind: string;
  message: string;
}

/** What the replay leaves for commit validation. */
export interface Replay {
  /** The staged writes replayed. */
  replayed: number;
  /** The seqs of staged deletes that found nothing: done (V20). */
  alreadyGone: number[];
  /** Each staged entity delete's children over the parent relations,
   * read with the entity locked, just before its delete. */
  deletedChildren: { seq: number; entityId: string; children: ParentLink[] }[];
  /** The write that could not be replayed; nothing after it ran. */
  fault: Violation | null;
}

/** The answer of a commit. */
export interface CommitAnswer {
  committed: number;
  alreadyGone: number[];
}

/*
 * The texts of a staged write's markers and violations say what is wrong
 * in words a person reads: no id and no fix. The seq names the write, so
 * its own target goes unnamed; another entity is named by its role (the
 * source or target end). Type, lens and anchor keys stay.
 */

const DRIFTED = "Changed since this write was staged";
const DELETED_SINCE = "Deleted since this write was staged";

/** An entity a staged write names that is neither stored nor created by
 * a staged write still in the changeset; `role` null is its own target. */
function neitherStored(role: string | null): string {
  return role === null
    ? "Neither stored nor created in this changeset"
    : `${role} is neither stored nor created in this changeset`;
}

/** A staged write that cannot be replayed; its message names only what
 * the caller sent. */
class ReplayFault extends Error {}

/** Thrown inside the commit transaction to roll it back with these. */
class CommitRejected extends Error {
  constructor(readonly violations: Violation[]) {
    super("Commit rejected");
  }
}

/** The one-line text of a write's field errors; null when there are none. */
function fieldFaults(errors: FieldErrors): string | null {
  const fields = Object.entries(errors);
  if (fields.length === 0) return null;
  return `Instance validation failed: ${fields.map(([key, message]) => `${key}: ${message}`).join("; ")}`;
}

function faultOn(errors: FieldErrors): void {
  const message = fieldFaults(errors);
  if (message !== null) throw new ReplayFault(message);
}

/** One staged write, replayed through the store's write method with its
 * search work, as the immediate write runs it. */
async function replayOne(
  loaded: LoadedSchema,
  plan: (change: SearchChange) => SearchWritePlan | null,
  readings: Record<string, ParentEnd>,
  write: ChangesetWriteRecord,
  bound: RuntimeStore,
  replay: Replay,
): Promise<void> {
  const args = write.arguments;
  const properties = (args.properties ?? {}) as Row;
  switch (write.operation) {
    case "create_entity": {
      const { errors, write: prepared } = prepareCreateEntity(loaded, write.typeKey, properties, null, {
        entityId: write.mintedId!,
        relationId: randomUUID(),
      });
      faultOn(errors);
      const e = prepared.entity;
      await bound.createEntity(e.entityTypeKey, e.entityId, e.properties, e.propertyDefs, plan(e.change));
      return;
    }
    case "update_entity": {
      const { errors, write: prepared } = prepareUpdateEntity(loaded, write.typeKey, write.targetId!, properties);
      faultOn(errors);
      if (prepared === null) return;
      const updated = await bound.updateEntity(
        prepared.entityTypeKey,
        prepared.entityId,
        prepared.setProperties,
        prepared.removeProperties,
        prepared.propertyDefs,
        plan(prepared.change),
      );
      if (updated === null) throw new ReplayFault(DELETED_SINCE);
      return;
    }
    case "delete_entity": {
      const prepared = prepareDeleteEntity(loaded, write.typeKey, write.targetId!);
      // Delete capture: X locked, so no child can attach until COMMIT, and
      // its children recorded before the cascade erases them.
      const children = await bound.childrenOf([prepared.entityId], readings, true);
      replay.deletedChildren.push({ seq: write.seq, entityId: prepared.entityId, children });
      if (!(await bound.deleteEntity(prepared.entityTypeKey, prepared.entityId, plan(prepared.change)))) {
        replay.alreadyGone.push(write.seq);
      }
      return;
    }
    case "create_relation": {
      const { errors, write: prepared } = prepareCreateRelation(
        loaded,
        write.typeKey,
        args.fromEntityId as string,
        args.toEntityId as string,
        properties,
        write.mintedId!,
      );
      faultOn(errors);
      await bound.createRelation(
        prepared.relationTypeKey,
        prepared.relationId,
        prepared.fromEntityId,
        prepared.toEntityId,
        prepared.properties,
        prepared.propertyDefs,
        plan(prepared.change),
      );
      return;
    }
    case "update_relation": {
      const { errors, write: prepared } = prepareUpdateRelation(loaded, write.typeKey, write.targetId!, properties);
      faultOn(errors);
      if (prepared === null) return;
      const updated = await bound.updateRelation(
        prepared.relationTypeKey,
        prepared.relationId,
        prepared.setProperties,
        prepared.removeProperties,
        prepared.propertyDefs,
        plan(prepared.change),
      );
      if (updated === null) throw new ReplayFault(DELETED_SINCE);
      return;
    }
    case "delete_relation": {
      const prepared = prepareDeleteRelation(loaded, write.typeKey, write.targetId!);
      if (!(await bound.deleteRelation(prepared.relationTypeKey, prepared.relationId, plan(prepared.change)))) {
        replay.alreadyGone.push(write.seq);
      }
      return;
    }
    default:
      throw new ReplayFault(`Unknown operation '${write.operation}'`);
  }
}

/** A replay fault's text. A relation create the store refuses as not
 * found names an end gone since the lock-free pass, by its role; any other
 * fault keeps its text. */
function replayMessage(write: ChangesetWriteRecord, error: Error): string {
  if (error instanceof NotFoundError && write.operation === "create_relation") {
    return "The source or target end no longer exists";
  }
  return error.message;
}

/**
 * Step 2 of the commit (V20): replay the journal by seq on the bound
 * store, each write through its `prepare…` and the store's write method,
 * its search work queued in the same transaction (V23). A staged entity
 * delete first locks the entity and records its children; a delete that
 * finds nothing is done, and noted. No savepoints: the first write that
 * fails ends the replay as its `fault` (an unknown id, a reference to an
 * entity that does not exist, a value the lens no longer accepts). Any
 * other error, a lock wait past the timeout among them, is thrown.
 */
export async function replayJournal(
  loaded: LoadedSchema,
  search: SearchContext,
  changesetId: string,
  bound: RuntimeStore,
): Promise<Replay> {
  const replay: Replay = { replayed: 0, alreadyGone: [], deletedChildren: [], fault: null };
  const plan = (change: SearchChange): SearchWritePlan | null => planSearchWrite(search.dependencies, change);
  const readings = parentReadings(loaded.full);
  const changesets = bound.changesets();
  for (let offset = 0; ; offset += REPLAY_PAGE) {
    const writes = await changesets.page(changesetId, offset, REPLAY_PAGE);
    for (const write of writes) {
      try {
        await replayOne(loaded, plan, readings, write, bound, replay);
      } catch (error) {
        if (error instanceof ReplayFault || error instanceof NotFoundError) {
          replay.fault = { seq: write.seq, kind: "replay", message: replayMessage(write, error) };
          return replay;
        }
        throw error;
      }
      replay.replayed += 1;
    }
    if (writes.length < REPLAY_PAGE) return replay;
  }
}

// ---------------------------------------------------------------------------
// The lock-free pass (V19)
// ---------------------------------------------------------------------------

/** Stored entities and relations are read in batches of this many ids. */
const READ_BATCH = 1000;

/** What the lock-free pass found, and what the commit's later steps take
 * from it. */
export interface LockFreePass {
  /** Every staged write, by seq. */
  writes: ChangesetWriteRecord[];
  /** The faults, by seq. */
  faults: Violation[];
  /** The targets of the staged updates and deletes that no staged create
   * minted: the rows step 1 locks. */
  targets: string[];
  /** The entities the journal names that are stored, as id → type. */
  stored: Map<string, string>;
  /** The staged creates, by the id they minted. */
  minted: Map<string, ChangesetWriteRecord>;
}

/** The document property keys of every entity type of the full schema
 * that has any, as the fingerprinting reads take them. */
function documentKeysOf(loaded: LoadedSchema): Record<string, string[]> {
  const keys: Record<string, string[]> = {};
  for (const [typeKey, type] of Object.entries(loaded.full.entityTypes)) {
    const documents = [...documentPropertyKeys(type.properties)];
    if (documents.length > 0) keys[typeKey] = documents;
  }
  return keys;
}

/** The stored entities of `ids` (any type), as id → row, read raw in
 * batches, each document value as its hash and length
 * (`recordedDocument`'s form): no stored document text is read. */
async function storedEntities(loaded: LoadedSchema, ids: string[], store: RuntimeStore): Promise<Map<string, Row>> {
  const documents = documentKeysOf(loaded);
  const rows = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += READ_BATCH) {
    const batch = await store.getEntitiesByIdsHashed(ids.slice(i, i + READ_BATCH), documents);
    for (const [id, row] of Object.entries(batch)) rows.set(id, row);
  }
  return rows;
}

/** The type of each stored entity of `ids`, read in batches without its
 * properties. */
async function entityTypes(ids: string[], store: RuntimeStore): Promise<Map<string, string>> {
  const types = new Map<string, string>();
  for (let i = 0; i < ids.length; i += READ_BATCH) {
    const batch = await store.getEntityTypes(ids.slice(i, i + READ_BATCH));
    for (const [id, type] of Object.entries(batch)) types.set(id, type);
  }
  return types;
}

/** The stored rows the checks of staged writes judge them against, raw:
 * entities by id (documents as hash and length), relations by id, of any
 * type. */
interface Stored {
  entities: Map<string, Row>;
  relations: Map<string, Row>;
}

/**
 * The stored rows `writes` name, in batches: the relations they update
 * or delete that no staged create minted, and the entities they name
 * that no staged create minted (`minted` holds every create that minted
 * an id they name): targets and the ends of created relations, and with
 * `ends` the ends of every relation they update or delete too, whose
 * names the review shows.
 */
async function storedRows(
  loaded: LoadedSchema,
  writes: ChangesetWriteRecord[],
  minted: Map<string, ChangesetWriteRecord>,
  ends: boolean,
  store: RuntimeStore,
): Promise<Stored> {
  const mintedAs = (id: string, create: string): boolean => minted.get(id)?.operation === create;
  const relationWrites = writes.filter(
    (write) => write.operation === "update_relation" || write.operation === "delete_relation",
  );
  const relationIds = new Set(
    relationWrites.map((write) => write.targetId!).filter((id) => !mintedAs(id, "create_relation")),
  );
  const relations = new Map<string, Row>();
  const ids = [...relationIds];
  for (let i = 0; i < ids.length; i += READ_BATCH) {
    const batch = await store.getRelationsByIds(ids.slice(i, i + READ_BATCH));
    for (const [id, row] of Object.entries(batch)) relations.set(id, row);
  }

  const named = new Set(writes.flatMap(entityRefs));
  if (ends) {
    for (const write of relationWrites) {
      const create = minted.get(write.targetId!);
      const relation = relations.get(write.targetId!);
      const at =
        create?.operation === "create_relation"
          ? create.arguments
          : relation?._relationTypeKey === write.typeKey
            ? relation
            : undefined;
      if (at === undefined) continue;
      named.add(at.fromEntityId as string);
      named.add(at.toEntityId as string);
    }
  }
  const entityIds = [...named].filter((id) => !mintedAs(id, "create_entity"));
  return { entities: await storedEntities(loaded, entityIds, store), relations };
}

/**
 * The staged creates that minted an id `writes` name, by that id, for
 * judging `writes` alone: their own creates, and in one batched read
 * those still in the journal that minted a target or a relation end of
 * theirs; then, in one more, those that minted an end of a relation that
 * a staged create minted and they update or delete.
 */
async function mintedFor(
  changesetId: string,
  writes: ChangesetWriteRecord[],
  store: RuntimeStore,
): Promise<Map<string, ChangesetWriteRecord>> {
  const minted = mintedBy(writes);
  const lookUp = async (ids: string[]): Promise<void> => {
    const unknown = [...new Set(ids)].filter((id) => !minted.has(id));
    if (unknown.length === 0) return;
    for (const create of await store.changesets().findMintedAmong(changesetId, unknown)) {
      minted.set(create.mintedId!, create);
    }
  };
  await lookUp(writes.flatMap((write) => [...(write.targetId === null ? [] : [write.targetId]), ...entityRefs(write)]));
  await lookUp(
    writes.flatMap((write) => {
      const create = write.targetId === null ? undefined : minted.get(write.targetId);
      return write.operation.endsWith("_relation") && create !== undefined ? createRefs(create).map(([, id]) => id) : [];
    }),
  );
  return minted;
}

/** The entities a staged create names, each as role → id: a relation's
 * ends. */
function createRefs(write: ChangesetWriteRecord): [string, string][] {
  const args = write.arguments;
  if (write.operation !== "create_relation") return [];
  return [
    ["The source end", args.fromEntityId as string],
    ["The target end", args.toEntityId as string],
  ];
}

/** The entity ids a staged write names: its target, its relation ends. */
function entityRefs(write: ChangesetWriteRecord): string[] {
  switch (write.operation) {
    case "create_relation":
      return createRefs(write).map(([, id]) => id);
    case "update_entity":
    case "delete_entity":
      return [write.targetId!];
    default:
      return [];
  }
}

/** What of a write the lens no longer shows (V19, V41), as a text that
 * names neither the type nor the property; null when all is shown. */
function hiddenPart(loaded: LoadedSchema, write: ChangesetWriteRecord): string | null {
  const lens = loaded.scoped;
  const through = `is no longer visible through lens '${lens.lensKey}'`;
  const type = write.operation.endsWith("_entity")
    ? lens.entityTypes[write.typeKey]
    : lens.relationTypes[write.typeKey];
  if (type === undefined) return `The type of this write ${through}`;
  const properties = Object.keys((write.arguments.properties ?? {}) as Row);
  if (properties.some((key) => !Object.hasOwn(type.properties, key))) {
    return `A property this write sets ${through}`;
  }
  return null;
}

/** The field faults the current lens finds in a staged write's values, as
 * its replay would meet them; null when there are none. */
function valueFaults(loaded: LoadedSchema, write: ChangesetWriteRecord): string | null {
  const args = write.arguments;
  const properties = (args.properties ?? {}) as Row;
  switch (write.operation) {
    case "create_entity":
      return fieldFaults(
        prepareCreateEntity(loaded, write.typeKey, properties, null, {
          entityId: write.mintedId!,
          relationId: randomUUID(),
        }).errors,
      );
    case "update_entity":
      return fieldFaults(prepareUpdateEntity(loaded, write.typeKey, write.targetId!, properties).errors);
    case "create_relation":
      return fieldFaults(
        prepareCreateRelation(
          loaded,
          write.typeKey,
          args.fromEntityId as string,
          args.toEntityId as string,
          properties,
          write.mintedId!,
        ).errors,
      );
    case "update_relation":
      return fieldFaults(prepareUpdateRelation(loaded, write.typeKey, write.targetId!, properties).errors);
    default:
      return null;
  }
}

/** Whether `value` is a document as `recordedDocument` keeps it. */
function isRecordedDocument(value: unknown): value is Row {
  return typeof value === "object" && value !== null && typeof (value as Row).sha256 === "string";
}

/** Recorded values as drift compares them: a document by its hash alone. */
function byHash(values: Row | null, documents: Set<string>): Row | null {
  if (values === null) return null;
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      documents.has(key) && isRecordedDocument(value) ? value.sha256 : value,
    ]),
  );
}

/** Whether the stored values of a staged update's patched keys now differ
 * from its `before` (V10): raw, absent distinct from null, a document by
 * its hash. */
function drifted(loaded: LoadedSchema, write: ChangesetWriteRecord, stored: Row): boolean {
  const types = write.operation === "update_entity" ? loaded.full.entityTypes : loaded.full.relationTypes;
  const defs = types[write.typeKey]?.properties ?? {};
  const keys = Object.keys((write.arguments.properties ?? {}) as Row);
  const documents = documentPropertyKeys(defs);
  return !isDeepStrictEqual(byHash(write.before, documents), byHash(recordedValues(stored, keys, defs), documents));
}

function driftFault(write: ChangesetWriteRecord): Violation {
  return { seq: write.seq, kind: "drift", message: DRIFTED };
}

/**
 * The lock-free pass (V19, V5 d): one paged read of the journal and of
 * the stored rows it names, with no lock and no transaction. Per staged
 * write, by seq, it finds:
 *
 * - `not_visible`: its type or a property it sets is no longer in the lens
 *   (V41); nothing else is checked on that write;
 * - `replay`: a value the lens no longer accepts, as the replay would
 *   meet it;
 * - `missing`: the target of an update, stored at staging, is gone;
 * - `dangling`: an id it names is neither stored nor minted by a create
 *   still in the journal: the target of an update minted by a create
 *   since unstaged (V6), or a relation end;
 * - `drift`: a stored update target's values of the patched keys differ
 *   from its `before` (V10).
 *
 * A delete whose target is gone is no fault: the replay counts it as done
 * (V20). Submit and the commit run the pass; the review reads judge their
 * own writes the same way (`passFaults`). Stored rows are read in
 * batches, documents as hash and length (`storedRows`).
 */
export async function lockFreePass(
  loaded: LoadedSchema,
  changesetId: string,
  store: RuntimeStore,
): Promise<LockFreePass> {
  const writes: ChangesetWriteRecord[] = [];
  for (let offset = 0; ; offset += REPLAY_PAGE) {
    const page = await store.changesets().page(changesetId, offset, REPLAY_PAGE);
    writes.push(...page);
    if (page.length < REPLAY_PAGE) break;
  }
  const minted = mintedBy(writes);
  const rows = await storedRows(loaded, writes, minted, false, store);
  const stored = new Map([...rows.entities].map(([id, row]) => [id, row._entityTypeKey as string] as const));
  const { faults, targets } = passFaults(loaded, writes, minted, rows);
  return { writes, faults, targets, stored, minted };
}

/** The staged creates among `writes`, by the id they minted. */
function mintedBy(writes: ChangesetWriteRecord[]): Map<string, ChangesetWriteRecord> {
  return new Map(writes.filter((w) => w.mintedId !== null).map((w) => [w.mintedId!, w] as const));
}

/**
 * The pass's judgement of `writes`, given the staged creates (`minted`)
 * and the stored rows (`stored`) their ids may name: the faults by seq,
 * and the stored targets. Sound for any `writes` whose minted ids, named
 * entities and relation targets those maps hold.
 */
function passFaults(
  loaded: LoadedSchema,
  writes: ChangesetWriteRecord[],
  minted: Map<string, ChangesetWriteRecord>,
  stored: Stored,
): { faults: Violation[]; targets: string[] } {
  const rows = stored.entities;
  const mintedAs = (id: string, create: string): boolean => minted.get(id)?.operation === create;
  const faults: Violation[] = [];
  const targets = new Set<string>();
  for (const write of writes) {
    const fault = (kind: string, message: string): void => {
      faults.push({ seq: write.seq, kind, message });
    };
    const hidden = hiddenPart(loaded, write);
    if (hidden !== null) {
      fault("not_visible", hidden);
      continue;
    }
    const invalid = valueFaults(loaded, write);
    if (invalid !== null) fault("replay", invalid);

    const kind = write.operation.endsWith("_entity") ? "entity" : "relation";
    const target = write.targetId;
    if (target !== null && !mintedAs(target, `create_${kind}`)) targets.add(target);

    switch (write.operation) {
      case "create_entity":
      case "create_relation":
        for (const [role, id] of createRefs(write)) {
          if (!rows.has(id) && !mintedAs(id, "create_entity")) fault("dangling", neitherStored(role));
        }
        break;
      case "update_entity":
      case "update_relation": {
        if (mintedAs(target!, `create_${kind}`)) break;
        const row = kind === "entity" ? rows.get(target!) : stored.relations.get(target!);
        const typeKey = kind === "entity" ? row?._entityTypeKey : row?._relationTypeKey;
        const current = typeKey === write.typeKey ? row! : null;
        if (current === null) {
          // A stored target had a `before` at staging; a minted one had none.
          if (write.before !== null) fault("missing", DELETED_SINCE);
          else fault("dangling", neitherStored(null));
        } else if (write.before !== null && drifted(loaded, write, current)) {
          faults.push(driftFault(write));
        }
        break;
      }
    }
  }
  return { faults, targets: [...targets] };
}

// ---------------------------------------------------------------------------
// The review read (V41)
// ---------------------------------------------------------------------------

/** The keys of `values` the lens shows, document values as the reads stub
 * them. */
function shownValues(values: Row, properties: Record<string, PropertyDef>): Row {
  const shown = Object.fromEntries(Object.entries(values).filter(([key]) => Object.hasOwn(properties, key)));
  return stubDocumentProperties(shown, properties);
}

/** A staged update's recorded values of `keys` as the review shows them:
 * null for a key the target lacked, a document as the read stub with the
 * length it was recorded with (null when it was recorded without one). */
function recordedView(recorded: Row, keys: string[], properties: Record<string, PropertyDef>): Row {
  const documents = documentPropertyKeys(properties);
  return Object.fromEntries(
    keys.map((key) => {
      const value = recorded[key] ?? null;
      if (!documents.has(key) || !isRecordedDocument(value)) return [key, value];
      return [key, { document: true, length: typeof value.length === "number" ? value.length : null }];
    }),
  );
}

/** A stored target's values of `keys` as the review shows them as
 * `current`: null for a key it lacks, a document as the read stub, its
 * length from the hash and length the store read it as. */
function currentView(stored: Row, keys: string[], properties: Record<string, PropertyDef>): Row {
  const current = shownValues(Object.fromEntries(keys.map((key) => [key, stored[key] ?? null])), properties);
  for (const key of keys) {
    const value = stored[key];
    if (properties[key]?.dataType === "document" && isRecordedDocument(value)) {
      current[key] = { document: true, length: value.length };
    }
  }
  return current;
}

/**
 * Staged writes as the review shows them (V41): names resolved, `before`,
 * `current` and `after`, and the markers `pass` found on them, judged with
 * the creates it holds, against the stored rows `stored` holds: every
 * entity they name, relation ends included, and every relation they
 * update or delete. The staged arguments are not shown, and every
 * document value is a stub (`getStagedDocument` reads the staged text).
 * Through the lens: a hidden type keeps only seq, operation and markers,
 * and hidden properties and names are not returned.
 */
function reviewPage(
  loaded: LoadedSchema,
  writes: ChangesetWriteRecord[],
  pass: Pick<LockFreePass, "faults" | "minted">,
  stored: Stored,
): StagedWriteView[] {
  const lens = loaded.scoped;
  const markers = new Map<number, Marker[]>();
  for (const fault of pass.faults) {
    markers.set(fault.seq, [...(markers.get(fault.seq) ?? []), { kind: fault.kind, message: fault.message }]);
  }
  const mintedAs = (id: string | null, create: string): ChangesetWriteRecord | undefined => {
    const write = id === null ? undefined : pass.minted.get(id);
    return write?.operation === create ? write : undefined;
  };

  // The ends of each relation write: from its create, or the stored relation.
  const relationEnds = new Map<number, [string, string]>();
  const storedRelations = new Map<number, Row>();
  for (const write of writes) {
    if (!write.operation.endsWith("_relation") || lens.relationTypes[write.typeKey] === undefined) continue;
    const create = write.operation === "create_relation" ? write : mintedAs(write.targetId, "create_relation");
    if (create !== undefined) {
      relationEnds.set(write.seq, [create.arguments.fromEntityId as string, create.arguments.toEntityId as string]);
      continue;
    }
    const relation = stored.relations.get(write.targetId!);
    if (relation?._relationTypeKey !== write.typeKey) continue;
    storedRelations.set(write.seq, relation);
    relationEnds.set(write.seq, [relation.fromEntityId as string, relation.toEntityId as string]);
  }

  // Raw rows: the name property is a string, never a document.
  const rows = Object.fromEntries(stored.entities);

  const nameOf = (id: string): string | null => {
    const row = rows[id];
    const create = row === undefined ? mintedAs(id, "create_entity") : undefined;
    const type = row !== undefined ? (row._entityTypeKey as string) : create?.typeKey;
    const nameProperty = type === undefined ? null : (lens.entityTypes[type]?.nameProperty ?? null);
    if (nameProperty === null) return null;
    const value = row !== undefined ? row[nameProperty] : (create!.arguments.properties as Row | undefined)?.[nameProperty];
    return typeof value === "string" ? value : null;
  };
  const end = (id: string): EndView => ({ id, name: nameOf(id) });

  return writes.map((write) => {
    const isEntity = write.operation.endsWith("_entity");
    const type = isEntity ? lens.entityTypes[write.typeKey] : lens.relationTypes[write.typeKey];
    const view: StagedWriteView = {
      seq: write.seq,
      operation: write.operation,
      type: null,
      id: null,
      createdAt: write.createdAt,
      before: null,
      current: null,
      after: null,
      markers: markers.get(write.seq) ?? [],
    };
    if (type === undefined) return view;

    const id = (write.mintedId ?? write.targetId)!;
    view.type = write.typeKey;
    view.id = id;
    const staged = (write.arguments.properties ?? {}) as Row;
    if (write.operation.startsWith("create_") || write.operation.startsWith("update_")) {
      view.after = shownValues(staged, type.properties);
    }
    if (write.operation.startsWith("update_") && write.before !== null) {
      // A stored target: its values as staged against, and its values now,
      // unless it is gone (or now of another type).
      const keys = Object.keys(staged).filter((key) => Object.hasOwn(type.properties, key));
      view.before = recordedView(write.before, keys, type.properties);
      const target = isEntity
        ? rows[id]?._entityTypeKey === write.typeKey
          ? rows[id]
          : undefined
        : storedRelations.get(write.seq);
      if (target !== undefined) view.current = currentView(target, keys, type.properties);
    }
    if (isEntity) {
      view.name = nameOf(id);
    } else {
      const ends = relationEnds.get(write.seq);
      view.from = ends === undefined ? null : end(ends[0]);
      view.to = ends === undefined ? null : end(ends[1]);
    }
    return view;
  });
}

// ---------------------------------------------------------------------------
// Commit validation (V21, V22)
// ---------------------------------------------------------------------------

/** Step 1, after the lock: every stored target `FOR UPDATE`, and drift
 * re-checked on the rows as locked (V19), documents read as hash and
 * length. A target gone since the pass is left to the replay. */
async function driftUnderLock(loaded: LoadedSchema, pass: LockFreePass, bound: RuntimeStore): Promise<Violation[]> {
  if (pass.targets.length === 0) return [];
  const targets = await bound.lockTargets(pass.targets, documentKeysOf(loaded));
  const locked = new Map(targets.map((row) => [`${row.kind} ${row.id}`, row] as const));
  const violations: Violation[] = [];
  for (const write of pass.writes) {
    if (write.before === null || (write.operation !== "update_entity" && write.operation !== "update_relation")) continue;
    const row = locked.get(`${write.operation === "update_entity" ? "entity" : "relation"} ${write.targetId}`);
    if (row !== undefined && row.typeKey === write.typeKey && drifted(loaded, write, row.props)) {
      violations.push(driftFault(write));
    }
  }
  return violations;
}

/** The parent links `ids` hang from, and those of their ancestors, walked
 * up level by level over the neutral reads: child id → its links. Each id
 * is read once, so a cycle ends the walk. */
async function ancestry(
  ids: string[],
  readings: Record<string, ParentEnd>,
  store: RuntimeStore,
): Promise<Map<string, ParentLink[]>> {
  const links = new Map<string, ParentLink[]>();
  let frontier = [...new Set(ids)];
  while (frontier.length > 0) {
    for (const id of frontier) links.set(id, []);
    const next = new Set<string>();
    for (const link of await store.parentsOf(frontier, readings)) {
      links.get(link.childId)?.push(link);
      if (!links.has(link.parentId)) next.add(link.parentId);
    }
    frontier = [...next];
  }
  return links;
}

/** Whether `target` is `from` or one of its ancestors in `links`. */
function reaches(links: Map<string, ParentLink[]>, from: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const link of links.get(id) ?? []) stack.push(link.parentId);
  }
  return false;
}

/** One entity a staged write touches inside the anchor's hierarchy. */
interface TouchedEnd {
  id: string;
  /** Stored before the replay. */
  before: boolean;
}

/** What a staged write touches inside the anchor's hierarchy. */
interface Touch {
  seq: number;
  ends: TouchedEnd[];
}

/** An anchored changeset's anchor, read fresh in the transaction, and
 * what its staged writes touch. */
interface Coverage {
  key: string;
  anchorId: string;
  readings: Record<string, ParentEnd>;
  touches: Touch[];
  /** The seqs already refused before the replay: one violation each. */
  refused: Set<number>;
}

/** The entities of the anchor's hierarchy a staged write touches: an
 * entity write its entity; a relation write both ends, a stored
 * relation's as stored before the replay. */
async function touchOf(
  loaded: LoadedSchema,
  pass: LockFreePass,
  types: Set<string>,
  write: ChangesetWriteRecord,
  bound: RuntimeStore,
): Promise<Touch> {
  const ends: { id: string; type: string; before: boolean }[] = [];
  const storedBefore = (id: string): boolean => pass.stored.has(id);
  if (write.operation.endsWith("_entity")) {
    const id = (write.mintedId ?? write.targetId)!;
    ends.push({ id, type: write.typeKey, before: write.mintedId === null && storedBefore(id) });
  } else {
    const rt = loaded.full.relationTypes[write.typeKey];
    const mintedBy = write.targetId === null ? undefined : pass.minted.get(write.targetId);
    const create =
      write.operation === "create_relation" ? write : mintedBy?.operation === "create_relation" ? mintedBy : undefined;
    let pair: [string, string, boolean, boolean] | null = null;
    if (create !== undefined) {
      const from = create.arguments.fromEntityId as string;
      const to = create.arguments.toEntityId as string;
      pair = [from, to, storedBefore(from), storedBefore(to)];
    } else {
      const relation = await bound.getRelation(write.typeKey, write.targetId!);
      if (relation !== null) {
        pair = [relation.fromEntityId as string, relation.toEntityId as string, true, true];
      }
    }
    if (rt !== undefined && pair !== null) {
      ends.push({ id: pair[0], type: rt.fromEntityTypeKey, before: pair[2] });
      ends.push({ id: pair[1], type: rt.toEntityTypeKey, before: pair[3] });
    }
  }
  return {
    seq: write.seq,
    ends: ends.filter((end) => types.has(end.type)).map(({ id, before }) => ({ id, before })),
  };
}

/**
 * Step 1, on an anchored changeset (V8, V42): the anchor read fresh, and
 * the coverage before the replay. The anchor gone, dangling, or at an
 * entity the lens hides is one violation on seq 0 (the changeset as a
 * whole), and coverage is not checked. Otherwise, as v1's `AnchorGuard`
 * holds it: every touched entity of the anchor's hierarchy stored now is
 * covered, and no staged delete takes an entity any anchor points at.
 */
async function anchorBefore(
  loaded: LoadedSchema,
  key: string,
  pass: LockFreePass,
  bound: RuntimeStore,
): Promise<{ violations: Violation[]; coverage: Coverage | null }> {
  const record = await bound.rulesets().get(key);
  if (record === null) {
    return {
      violations: [{ seq: 0, kind: "anchor_gone", message: `Anchor '${key}' no longer exists, so this changeset cannot be committed` }],
      coverage: null,
    };
  }
  const refusal = changesetAnchorRefusal(key, record, loaded);
  if (refusal !== null) return { violations: [{ seq: 0, kind: "anchor_dangling", message: refusal }], coverage: null };
  if (record.anchor === null) return { violations: [], coverage: null };

  const { types, readings } = hierarchyOf(record.anchor.type, loaded.full);
  const touches: Touch[] = [];
  for (const write of pass.writes) touches.push(await touchOf(loaded, pass, types, write, bound));
  const coverage: Coverage = { key, anchorId: record.anchor.id, readings, touches, refused: new Set() };

  const before = touches.flatMap((touch) => touch.ends.filter((end) => end.before).map((end) => end.id));
  const links = await ancestry(before, readings, bound);
  const violations: Violation[] = [];
  for (const touch of touches) {
    if (touch.ends.some((end) => end.before && !reaches(links, end.id, coverage.anchorId))) {
      violations.push({
        seq: touch.seq,
        kind: "not_covered",
        message: `Not under anchor '${key}'`,
      });
    }
  }
  const deletes = pass.writes.filter((write) => write.operation === "delete_entity");
  const anchored =
    deletes.length === 0 ? new Set() : new Set((await bound.rulesets().list()).map((ruleset) => ruleset.anchor?.id));
  for (const write of deletes) {
    if (anchored.has(write.targetId!)) {
      violations.push({
        seq: write.seq,
        kind: "not_covered",
        message: "Anchored, so it cannot be deleted on an anchored connection",
      });
    }
  }
  for (const violation of violations) coverage.refused.add(violation.seq);
  return { violations, coverage };
}

/** A parent link a staged relation create creates, with the role of its
 * child. */
interface StagedLink {
  seq: number;
  relationId: string;
  parentId: string;
  childId: string;
  childRole: string;
}

/** A relation end a staged write names, by its role, with the type its
 * relation type requires there. */
interface StagedEnd {
  seq: number;
  role: Exclude<EndRole, "The parent">;
  id: string;
  type: string;
  relationType: string;
}

/** The parent links and the relation ends the staged relation creates
 * name. */
function stagedLinksAndEnds(loaded: LoadedSchema, writes: ChangesetWriteRecord[]): { links: StagedLink[]; ends: StagedEnd[] } {
  const links: StagedLink[] = [];
  const ends: StagedEnd[] = [];
  for (const write of writes) {
    if (write.operation !== "create_relation") continue;
    const rt = loaded.full.relationTypes[write.typeKey];
    if (rt === undefined) continue;
    const from = write.arguments.fromEntityId as string;
    const to = write.arguments.toEntityId as string;
    ends.push({ seq: write.seq, role: "The source end", id: from, type: rt.fromEntityTypeKey, relationType: rt.key });
    ends.push({ seq: write.seq, role: "The target end", id: to, type: rt.toEntityTypeKey, relationType: rt.key });
    if (rt.parent !== null) {
      const [parentId, childId, childRole] =
        rt.parent === "source" ? [from, to, "The target end"] : [to, from, "The source end"];
      links.push({ seq: write.seq, relationId: write.mintedId!, parentId, childId, childRole });
    }
  }
  return { links, ends };
}

/**
 * Step 3 (V21, V13): the rules over the end state, in the service, on the
 * bound store's neutral reads, after the replay. Messages name no id,
 * only roles, the relation type key and the anchor key:
 *
 * - `has_children`: a child recorded by a staged entity delete (the delete
 *   capture) is neither deleted nor re-parented;
 * - `two_parents`, `cycle`: v1's parent rules, for every parent link the
 *   changeset creates and keeps, across every parent relation of the full
 *   schema;
 * - `endpoint_type`: a created relation's end is not of the type its
 *   relation type requires;
 * - `not_covered`: on an anchored changeset, a touched entity of the
 *   anchor's hierarchy that exists now is not covered.
 */
async function commitViolations(
  loaded: LoadedSchema,
  pass: LockFreePass,
  replay: Replay,
  coverage: Coverage | null,
  bound: RuntimeStore,
): Promise<Violation[]> {
  const readings = parentReadings(loaded.full);
  const { links, ends } = stagedLinksAndEnds(loaded, pass.writes);
  const children = replay.deletedChildren.flatMap((deleted) => deleted.children.map((child) => child.childId));
  const touched = coverage?.touches.flatMap((touch) => touch.ends.map((end) => end.id)) ?? [];
  const ids = new Set([...children, ...links.map((link) => link.childId), ...ends.map((end) => end.id), ...touched]);
  const types = await entityTypes([...ids], bound);
  const violations: Violation[] = [];

  const remaining = children.filter((id) => types.has(id));
  const parented = new Set((await bound.parentsOf(remaining, readings)).map((link) => link.childId));
  for (const deleted of replay.deletedChildren) {
    if (deleted.children.some((child) => types.has(child.childId) && !parented.has(child.childId))) {
      violations.push({
        seq: deleted.seq,
        kind: "has_children",
        message: "Still has children",
      });
    }
  }

  // As v1: an end of the wrong type is not judged by the parent rules.
  const mistyped = new Set<string>();
  for (const end of ends) {
    const type = types.get(end.id);
    if (type !== undefined && type !== end.type) {
      mistyped.add(`${end.seq} ${end.id}`);
      violations.push({
        seq: end.seq,
        kind: "endpoint_type",
        message: endpointTypeMessage(end.role, end.relationType),
      });
    }
  }

  const kept = links.filter(
    (link) =>
      types.has(link.childId) &&
      !mistyped.has(`${link.seq} ${link.childId}`) &&
      !mistyped.has(`${link.seq} ${link.parentId}`),
  );
  const walk = await ancestry(
    kept.map((link) => link.childId),
    readings,
    bound,
  );
  for (const link of kept) {
    const own = walk.get(link.childId) ?? [];
    if (!own.some((stored) => stored.relationId === link.relationId)) continue;
    if (own.length > 1) {
      violations.push({ seq: link.seq, kind: "two_parents", message: `${link.childRole} already has a parent` });
    }
    if (reaches(walk, link.parentId, link.childId)) {
      violations.push({
        seq: link.seq,
        kind: "cycle",
        message: "This parent link would close a cycle",
      });
    }
  }

  if (coverage !== null) {
    const after = coverage.touches.flatMap((touch) => touch.ends.map((end) => end.id)).filter((id) => types.has(id));
    const walkAfter = await ancestry(after, coverage.readings, bound);
    for (const touch of coverage.touches) {
      if (coverage.refused.has(touch.seq)) continue;
      if (touch.ends.some((end) => types.has(end.id) && !reaches(walkAfter, end.id, coverage.anchorId))) {
        violations.push({
          seq: touch.seq,
          kind: "not_covered",
          message: `Would not be under anchor '${coverage.key}' after the commit`,
        });
      }
    }
  }
  return violations;
}

/** A 422 with the first violations by seq and their total (R4). */
function violationsError(message: string, violations: Violation[]): ValidationError {
  const bySeq = [...violations].sort((a, b) => a.seq - b.seq);
  return new ValidationError(message, {
    violations: bySeq.slice(0, MAX_VIOLATIONS),
    total: violations.length,
  });
}

/** The 422 of a rejected commit. */
function rejection(violations: Violation[]): ValidationError {
  return violationsError("The commit was rejected; nothing was persisted", violations);
}

/**
 * Commit a changeset: everything it stages, or nothing (D3). With
 * `expectedVersion`, a changeset changed since (V40) is a 409. Another
 * commit on the ontology or in this process, a change running on the
 * changeset, or a row held past the lock timeout are 409s too, with
 * nothing persisted. A rejection is a 422 whose `details.violations` name
 * the seqs; the changeset stays as it was.
 * Committed, the changeset is gone.
 */
export async function commitChangeset(
  lensKey: string,
  anchorKey: string | null,
  changesetId: string,
  expectedVersion: number | undefined,
  store: RuntimeStore,
): Promise<CommitAnswer> {
  if (runningCommits >= MAX_RUNNING_COMMITS) {
    throw new ConflictError("Too many commits are running; try again");
  }
  const staleVersion = (version: number): ConflictError =>
    new ConflictError(`Changeset '${changesetId}' changed since you looked: version ${version}, not ${expectedVersion}`);
  runningCommits += 1;
  try {
    // 0a: before BEGIN, holding nothing. Nothing inside reaches the pool.
    const loaded = await loadSchema(lensKey, store);
    const record = await loadChangeset(loaded, anchorKey, changesetId, store);
    if (expectedVersion !== undefined && record.version !== expectedVersion) throw staleVersion(record.version);
    const search = await loadSearchContext(store.ontologyKey, store.searchIndices());
    try {
      // 0b: the lock-free pass; a fault rejects with no lock taken.
      const pass = await lockFreePass(loaded, record.id, store);
      if (pass.faults.length > 0) throw new CommitRejected(pass.faults);
      return await store.transaction(async (bound) => {
        // 1: the commit lock and the row, the version, then the targets
        // and drift under the lock, and the anchor read fresh.
        const locked = await bound.changesets().lockForCommit(record.id);
        if (locked === null) throw notFound(changesetId);
        if (expectedVersion !== undefined && locked.version !== expectedVersion) throw staleVersion(locked.version);
        if (locked.version !== record.version) {
          throw new ConflictError(`Changeset '${changesetId}' changed during the commit; try again`);
        }
        const drift = await driftUnderLock(loaded, pass, bound);
        if (drift.length > 0) throw new CommitRejected(drift);
        const anchor =
          record.rulesetKey === null ? null : await anchorBefore(loaded, record.rulesetKey, pass, bound);
        // 2: the replay; 3: commit validation.
        const replay = await replayJournal(loaded, search, record.id, bound);
        if (replay.fault !== null) throw new CommitRejected([replay.fault]);
        const violations = [
          ...(anchor?.violations ?? []),
          ...(await commitViolations(loaded, pass, replay, anchor?.coverage ?? null, bound)),
        ];
        if (violations.length > 0) throw new CommitRejected(violations);
        // 4: the journal goes with the changeset; COMMIT on return.
        await bound.changesets().deleteWithJournal(record.id);
        return { committed: replay.replayed, alreadyGone: replay.alreadyGone };
      });
    } catch (error) {
      if (!(error instanceof CommitRejected)) throw error;
      await store.changesets().touch(record.id);
      throw rejection(error.violations);
    }
  } finally {
    runningCommits -= 1;
  }
}
