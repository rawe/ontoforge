/**
 * Changesets: what a commit of one lens will apply to the live data,
 * staged over any time and persisted together by a commit. A changeset is
 * a set: per entity or relation it touches one staged object, and per
 * property of it at most one staged value; no history of calls is kept.
 * This module starts a changeset, stages into it, lists and reads it,
 * unstages an object or one value, rebases a value, submits and unsubmits
 * it, discards it and commits it. REST (`changesetRouter.ts`) is its
 * entrance; like the write functions of `service.ts`, every function takes
 * the lens key and the ruleset key of the URL (null on the plain lens)
 * first and the store last.
 *
 * - **Binding.** A changeset is bound to the lens it was started through
 *   and to the ruleset key of that URL. Through another lens, or another
 *   ruleset's URL, it is unknown; the plain lens URL reaches every
 *   changeset of its lens. Every unknown changeset (never existed,
 *   discarded, committed, expired, bound elsewhere) answers the one 404
 *   "Changeset '<id>' not found".
 * - **Staging** merges one call into the set; entities, relations and the
 *   search queue are untouched, and reads never see staged data. Its
 *   checks, in order: the changeset; the anchor of the URL's ruleset
 *   (deleted, or at an entity the lens hides: 409, as every write;
 *   coverage is a commit rule); the `prepare…` of the immediate write
 *   (`prepare.ts`: the type's 404 and the same 422 field errors); the
 *   target of an update, delete or document edit (created in this
 *   changeset, or else stored, read once: missing, or deleted in this
 *   changeset, is the immediate write's 404); the caps on objects and
 *   bytes (`valueBytes`). Relation ends are not checked here. The merge
 *   is read-modify-write: it is applied with a compare-and-set on the
 *   version it read, so a change in between is a 409 and nothing is
 *   written.
 * - **Lists.** A staging request may list up to `MAX_BATCH_ITEMS` calls,
 *   staged in list order in one transaction, whole or not at all
 *   (`stageBatch`).
 * - **Put** names an entity by the identity its values build, or a
 *   relation of a one-per-pair type by its pair, and resolves now, in the
 *   changeset's view, to an ordinary update of the one that has it, or
 *   else an ordinary create. The set only ever holds creates and updates.
 * - **Merging.** A create adds its object and one value per key sent; a
 *   create with a parent relation adds the relation's object too. An
 *   update of a stored object adds an `update` object if none is staged
 *   and writes each key sent; into a create it merges as the create's
 *   values, a null removing one. A delete of a stored object makes its
 *   object a `delete` and drops its values; a delete of an object created
 *   here removes the object. An entity delete also removes every staged
 *   relation at that entity, and answers their ids as `cascaded`. A
 *   document edit applies the immediate edit to the staged text, or else
 *   the stored one, and stages the whole result as the value.
 * - **Ids.** A create mints its final id now; later calls name it.
 * - **Before.** A value of an update records the stored value of its key
 *   at the key's first touch, raw: an absent key distinct from null, a
 *   document as its hash and length (`recordedBefore`). Staging never
 *   refreshes it; `rebase` does, on request. Drift is the stored value now
 *   (`current`) differing from it, a document by its hash.
 * - **Unstage, cut, rebase** remove an object with its values, remove one
 *   value (an update left without values goes too), or set the before of
 *   an update's values to the stored values now. Nothing cascades: what
 *   becomes invalid shows as a marker.
 * - **Expiry.** A draft changeset idle for 7 days is gone: checked on every
 *   access, where it is deleted and answers not found, and swept on start
 *   and on list. A submitted changeset never expires.
 * - **Write access** is checked by the entrances (`writeAccess.ts`), on
 *   the URL's ruleset, before any function here runs.
 * - **Lifecycle.** Submit freezes a draft changeset and hands it over with
 *   a note, after the lock-free pass and a compare-and-set on the version
 *   the pass saw. While submitted, staging, unstaging, cutting, rebasing
 *   and discarding are 409s, decided in the store's own statement;
 *   unsubmit (a note is required) makes it a draft again, and commit is
 *   the approval. A rejected commit leaves it as it was.
 * - **Review.** The list and the reads apply the lens as it is now: a type,
 *   property or name the lens hides is never shown. The review read shows
 *   every document value as a stub; the staged document read returns the
 *   staged text of one document property, and the staged entity read one
 *   entity as a commit would leave it, beside its staged object.
 * - **Commit.** Before BEGIN, holding nothing: the schema, the changeset
 *   and the search context are loaded, and the lock-free pass runs; any
 *   fault it finds rejects here. Then one transaction on one connection:
 *   the commit lock and the changeset row, the version check, every stored
 *   target `FOR UPDATE` with drift re-checked, the anchor read fresh; the
 *   staged objects applied in fixed phases (entity creates, entity
 *   updates, relation deletes, relation creates, relation updates, entity
 *   deletes), in batches through the store's batch writes with their
 *   search work; commit validation over the end state; the changeset deleted,
 *   COMMIT. Any failure rolls all of it back; a rejection (422, the
 *   violations by object and property) then refreshes the last change and
 *   keeps the version. One commit runs at a time in one process.
 * - **Check.** The commit's own steps, draft or submitted, rolled back
 *   where the commit would delete the changeset: it answers what the
 *   commit would, with the version it checked, and changes nothing, the
 *   last change included. It counts as a running commit.
 */

import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { CoercionError, assertNoNulCharacter } from "../core/dataTypes.js";
import { settings } from "../config.js";
import { ConflictError, IdentityTakenError, NotFoundError, ValidationError } from "../core/exceptions.js";
import type {
  ChangesetChange,
  ChangesetRecord,
  DesignRevision,
  NewStagedObject,
  NewStagedValue,
  ParentLink,
  RuntimeStore,
  SearchWritePlan,
  StagedAction,
  StagedKind,
  StagedObjectRecord,
  StagedValueRecord,
} from "../core/ports.js";
import type { ParentEnd, PropertyDef } from "../core/schemas.js";
import { planSearchWrite, type SearchChange } from "../core/searchDependencies.js";
import { AnchorGuard, changesetAnchorRefusal, hierarchyOf } from "./anchorGuard.js";
import { cpLength } from "./codePoints.js";
import { buildIdentity, identityValues } from "./identity.js";
import {
  entityIdentity,
  identityPropertiesOfType,
  prepareCreateEntity,
  prepareCreateRelation,
  prepareDeleteEntity,
  prepareDeleteRelation,
  prepareUpdateEntity,
  prepareUpdateRelation,
  touchesIdentity,
  updatedIdentity,
  type FieldErrors,
  type ParentRelationInput,
  type UpdateArgs,
} from "./prepare.js";
import { loadDesign, retryOnDesignChange } from "./designWrite.js";
import { docLengthKey, documentPropertyKeys, filterEntityProperties } from "./readHelpers.js";
import { loadSchema, type LoadedSchema, type SearchContext } from "./schemaCache.js";
import {
  HIDDEN_RELATIONS_MESSAGE,
  applyDocumentEdit,
  documentSlice,
  endpointTypeMessage,
  exactlyOne,
  exactlyOneFault,
  hasHiddenRelations,
  parentReadings,
  type DocumentEditBody,
  type EndRole,
  type ParentRelationRequest,
  type RelationEnds,
} from "./service.js";

type Row = Record<string, unknown>;

/** A draft changeset idle this long is gone. */
export const CHANGESET_IDLE_DAYS = 7;
/** The longest note, in characters. */
export const MAX_NOTE_LENGTH = 1000;
/** The most items one staging request lists. */
export const MAX_BATCH_ITEMS = 1000;

/** The size a staged value counts toward the byte cap
 * (`CHANGESET_MAX_BYTES`): the UTF-8 bytes of its value and its before as
 * JSON, document text included. */
export function valueBytes(value: unknown, before: Row | null): number {
  const recorded = before === null ? 0 : Buffer.byteLength(JSON.stringify(before));
  return Buffer.byteLength(JSON.stringify(value)) + recorded;
}

const IDLE_MS = CHANGESET_IDLE_DAYS * 24 * 3_600_000;

/** The entity a staged call names: by id or by identity, exactly one. */
export interface EntityAddress {
  id?: string | null | undefined;
  identity?: string | null | undefined;
}

/** One stageable call, as the entrances hand it over: the values of the
 * matching immediate write. An entity may be named by identity wherever
 * the immediate write takes one (`resolveWrite`). */
export type StagedWrite =
  | { operation: "create_entity"; typeKey: string; properties: Row; parentRelation: ParentRelationRequest | null }
  | ({ operation: "update_entity"; typeKey: string; properties: Row } & EntityAddress)
  | ({ operation: "delete_entity"; typeKey: string } & EntityAddress)
  | ({ operation: "create_relation"; typeKey: string; properties: Row } & RelationEnds)
  | { operation: "update_relation"; typeKey: string; id: string; properties: Row }
  | { operation: "delete_relation"; typeKey: string; id: string }
  | ({ operation: "edit_document"; typeKey: string; propertyKey: string; edit: DocumentEditBody } & EntityAddress)
  | { operation: "put_entity"; typeKey: string; properties: Row }
  | ({ operation: "put_relation"; typeKey: string; properties: Row } & RelationEnds);

/** A stageable call with every entity named by id. */
type ResolvedWrite =
  | { operation: "create_entity"; typeKey: string; properties: Row; parentRelation: ParentRelationInput | null }
  | { operation: "update_entity"; typeKey: string; id: string; properties: Row }
  | { operation: "delete_entity"; typeKey: string; id: string }
  | { operation: "create_relation"; typeKey: string; fromEntityId: string; toEntityId: string; properties: Row }
  | { operation: "update_relation"; typeKey: string; id: string; properties: Row }
  | { operation: "delete_relation"; typeKey: string; id: string }
  | { operation: "edit_document"; typeKey: string; id: string; propertyKey: string; edit: DocumentEditBody };

/** A staged call resolved (`resolveWrite`): a put names what it became. */
interface Resolved {
  write: ResolvedWrite;
  faults: FieldErrors;
  put?: "create" | "update";
}

/** A changeset as every answer shows it. */
export interface ChangesetView {
  id: string;
  number: number;
  state: "draft" | "submitted";
  version: number;
  note: string | null;
  /** The ruleset key of the URL that started it; null on the plain lens. */
  ruleset: string | null;
  objectCount: number;
  createdAt: Date;
  lastChangeAt: Date;
  submittedAt: Date | null;
}

/** One end of a staged relation. */
export interface EndView {
  id: string;
  /** Its name through the lens: the stored name when stored, the staged
   * one when this changeset creates it; null when the lens shows none. */
  name: string | null;
}

/** A fault the lock-free pass finds on a staged object or value. */
export interface Marker {
  kind: string;
  message: string;
}

/** One staged value as the review read shows it. */
export interface StagedValueView {
  property: string;
  /** An update's stored value of the key at its first touch (or its last
   * rebase); null for a key the target lacked, and on a create. */
  before: unknown;
  /** An update's stored value of the key now; null when the target is gone
   * or lacks the key, and on a create. Drift is `current` ≠ `before`. */
  current: unknown;
  /** The staged value; null removes the property. */
  after: unknown;
  /** The lock-free pass's faults on this value: drift or replay. */
  markers: Marker[];
}

/**
 * One staged object as the review read shows it, through the lens as it is
 * now. An object whose type the lens no longer shows keeps only its id,
 * kind, action, first touch and markers.
 */
export interface StagedObjectView {
  id: string;
  kind: StagedKind;
  /** The entity or relation type key; null when the lens hides it. */
  type: string | null;
  action: StagedAction;
  firstTouchedAt: Date;
  /** Entities: the name. */
  name?: string | null;
  /** Entities whose identity the changeset sets or changes, when the lens
   * shows it: the stored identity (null on a create) and the one after. */
  identity?: { before: string | null; after: string };
  /** Relations: the two ends. */
  from?: EndView;
  to?: EndView;
  /** The lock-free pass's faults on the object: not visible, missing,
   * dangling, or a value it needs and lacks. */
  markers: Marker[];
  /** Its staged values the lens shows, by property key; none on a delete. */
  values: StagedValueView[];
}

/** A changeset as the list shows it. */
export interface ChangesetListItem {
  id: string;
  number: number;
  state: "draft" | "submitted";
  version: number;
  note: string | null;
  ruleset: string | null;
  objectCount: number;
  /** The staged objects per operation: `create_entity`, `update_relation`, …. */
  operations: Record<string, number>;
  /** The type keys the staged objects name that the lens shows, sorted. */
  types: string[];
  /** How many type keys the staged objects name that the lens no longer
   * shows; they are left out of `types`. */
  notVisible: number;
  createdAt: Date;
  lastChangeAt: Date;
  submittedAt: Date | null;
}

/** The answer of a staged call: the id of its object. A create with a
 * parent relation adds the relation's; an entity delete the staged
 * relations it removed; a document edit the immediate edit's answer. */
export type StagedAnswer = Row & {
  id: string;
  relation?: { id: string };
  cascaded?: string[];
  /** A put's: what it staged. */
  action?: "create" | "update";
};

function notFound(id: string): NotFoundError {
  return new NotFoundError(`Changeset '${id}' not found`);
}

/** The 409 of every change while submitted. */
function isSubmitted(id: string): ConflictError {
  return new ConflictError(`Changeset '${id}' is submitted; unsubmit it first`);
}

function toView(record: ChangesetRecord): ChangesetView {
  return {
    id: record.id,
    number: record.number,
    state: record.submittedAt === null ? "draft" : "submitted",
    version: record.version,
    note: record.note,
    ruleset: record.rulesetKey,
    objectCount: record.objectCount,
    createdAt: record.createdAt,
    lastChangeAt: record.lastChangeAt,
    submittedAt: record.submittedAt,
  };
}

/** A valid note, or null; over the cap, or holding a NUL, is a 422. */
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
 * The changeset through its binding: another lens, or another ruleset's
 * URL, is not found. An expired one is deleted (with every other expired
 * one of the ontology) and is not found either.
 */
async function loadChangeset(
  loaded: LoadedSchema,
  rulesetKey: string | null,
  id: string,
  store: RuntimeStore,
): Promise<ChangesetRecord> {
  const changesets = store.changesets();
  const record = await changesets.get(id, loaded.scoped.lensId, rulesetKey);
  if (record === null) throw notFound(id);
  // A draft expires by the database's clock: whether it has is the sweep's to say.
  if (record.submittedAt === null && (await changesets.sweep(IDLE_MS)) > 0) {
    if ((await changesets.get(id, loaded.scoped.lensId, rulesetKey)) === null) throw notFound(id);
  }
  return record;
}

/** A draft changeset to change: submitted is the 409. */
async function loadDraft(
  loaded: LoadedSchema,
  rulesetKey: string | null,
  id: string,
  store: RuntimeStore,
): Promise<ChangesetRecord> {
  const record = await loadChangeset(loaded, rulesetKey, id, store);
  if (record.submittedAt !== null) throw isSubmitted(id);
  return record;
}

/** Apply a change to a draft changeset at the version read. The store
 * refused: gone is not found, submitted the 409, and a draft changed
 * since the read the 409 of a conflict. */
async function applyChange(
  loaded: LoadedSchema,
  rulesetKey: string | null,
  record: ChangesetRecord,
  change: ChangesetChange,
  store: RuntimeStore,
): Promise<ChangesetRecord> {
  const applied = await store.changesets().apply(record.id, record.version, change);
  if (applied !== null) return applied;
  const now = await store.changesets().get(record.id, loaded.scoped.lensId, rulesetKey);
  if (now === null) throw notFound(record.id);
  if (now.submittedAt !== null) throw isSubmitted(record.id);
  throw new ConflictError(`Changeset '${record.id}' changed meanwhile; try again`);
}

/** A ruleset key of the URL that names no ruleset is not found. */
async function checkRulesetExists(rulesetKey: string | null, store: RuntimeStore): Promise<void> {
  if (rulesetKey !== null && (await store.rulesets().get(rulesetKey)) === null) {
    throw new NotFoundError(`Ruleset '${rulesetKey}' not found`);
  }
}

/** Start a changeset bound to the lens and to the ruleset key of the URL.
 * Unknown lens or ruleset is not found, in that order. */
export async function startChangeset(
  lensKey: string,
  rulesetKey: string | null,
  note: string | null | undefined,
  store: RuntimeStore,
): Promise<ChangesetView> {
  const loaded = await loadSchema(lensKey, store);
  await checkRulesetExists(rulesetKey, store);
  const valid = validNote(note);
  const changesets = store.changesets();
  await changesets.sweep(IDLE_MS);
  const record = await changesets.start({ id: randomUUID(), lensId: loaded.scoped.lensId, rulesetKey: rulesetKey, note: valid });
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
function patchOf(write: UpdateArgs | null): Row {
  const keys = write !== null && "changedKeys" in write.change ? write.change.changedKeys : [];
  return Object.fromEntries(
    keys.map((key) => [key, Object.hasOwn(write!.setProperties, key) ? write!.setProperties[key] : null]),
  );
}

/** How a document value is kept in a before: its hash and its length in
 * characters, not its text. */
export function recordedDocument(text: string): Row {
  return { sha256: createHash("sha256").update(text, "utf8").digest("hex"), length: cpLength(text) };
}

/**
 * The stored value of `key` as a staged value records it in its before and
 * drift compares it: `{value}`, raw as the store reads it without
 * definitions, a document value as its hash and length
 * (`recordedDocument`); `{}` when the stored object does not hold the key,
 * distinct from a stored null.
 */
export function recordedBefore(stored: Row, key: string, propertyDefs: Record<string, PropertyDef>): Row {
  if (!Object.hasOwn(stored, key)) return {};
  const value = stored[key];
  const document = propertyDefs[key]?.dataType === "document" && typeof value === "string";
  return { value: document ? recordedDocument(value) : value };
}

/** The staged values of an object, as a property map. */
function valuesOf(object: StagedObjectRecord): Row {
  return Object.fromEntries(object.values.map((value) => [value.propertyKey, value.value]));
}

function newObject(
  kind: StagedKind,
  typeKey: string,
  objectId: string,
  action: StagedAction,
  ends: [string, string] | null = null,
): NewStagedObject {
  return { objectId, kind, typeKey, action, fromId: ends?.[0] ?? null, toId: ends?.[1] ?? null };
}

function newValue(objectId: string, propertyKey: string, value: unknown, before: Row | null): NewStagedValue {
  return { objectId, propertyKey, value, before, bytes: valueBytes(value, before) };
}

/** One staged call as a change of the set, and its answer. */
interface Merge {
  change: ChangesetChange;
  answer: StagedAnswer;
  /** The objects it adds. */
  added: number;
  /** How many bytes its values add, net of the values they replace. */
  grows: number;
}

/** The bytes `values` add over those of `object` they replace. */
function growth(object: StagedObjectRecord | undefined, values: NewStagedValue[]): number {
  const old = new Map((object?.values ?? []).map((value) => [value.propertyKey, value.bytes] as const));
  return values.reduce((sum, value) => sum + value.bytes - (old.get(value.propertyKey) ?? 0), 0);
}

function missing(kind: StagedKind, id: string): NotFoundError {
  return new NotFoundError(`${kind === "entity" ? "Entity" : "Relation"} '${id}' not found`);
}

/** The target of an update, delete or document edit: its staged object,
 * if any, and the stored row, null when this changeset creates it. */
interface Target {
  object: StagedObjectRecord | undefined;
  stored: Row | null;
}

/** The target, read once: created in this changeset, or else stored.
 * Deleted in this changeset, or neither, is the immediate write's 404. An
 * object of another kind or type staged under the id is not this target. */
async function target(
  changesetId: string,
  kind: StagedKind,
  typeKey: string,
  id: string,
  store: RuntimeStore,
): Promise<Target> {
  const [found] = await store.changesets().objects(changesetId, [id]);
  const object = found?.kind === kind && found.typeKey === typeKey ? found : undefined;
  if (object?.action === "delete") throw missing(kind, id);
  if (object?.action === "create") return { object, stored: null };
  const stored = kind === "entity" ? await store.getEntity(typeKey, id) : await store.getRelation(typeKey, id);
  if (stored === null) throw missing(kind, id);
  return { object, stored };
}

/** A stored relation's ends. */
function storedEnds(relation: Row): [string, string] {
  return [relation.fromEntityId as string, relation.toEntityId as string];
}

/**
 * A patch (key → value, null removing the key) merged into the object
 * staged on its target: into a create of this changeset as its values, a
 * null removing one; otherwise into the target's `update`, staged now if
 * there is none, each key keeping the before of its first touch and a key
 * touched first now recording the stored value.
 */
function patchMerge(
  at: Target,
  kind: StagedKind,
  typeKey: string,
  id: string,
  patch: Row,
  propertyDefs: Record<string, PropertyDef>,
): Merge {
  const answer = { id };
  const staged = new Map((at.object?.values ?? []).map((value) => [value.propertyKey, value] as const));
  if (at.stored === null) {
    const values: NewStagedValue[] = [];
    const removeValues: { objectId: string; propertyKey: string }[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (value !== null) values.push(newValue(id, key, value, null));
      else if (staged.has(key)) removeValues.push({ objectId: id, propertyKey: key });
    }
    return { change: { removeValues, values }, answer, added: 0, grows: growth(at.object, values) };
  }
  const stored = at.stored;
  const values = Object.entries(patch).map(([key, value]) =>
    newValue(id, key, value, staged.get(key)?.before ?? recordedBefore(stored, key, propertyDefs)),
  );
  // A patch that changes nothing stages nothing.
  if (values.length === 0) return { change: {}, answer, added: 0, grows: 0 };
  const ends = kind === "relation" ? storedEnds(stored) : null;
  const objects = at.object === undefined ? [newObject(kind, typeKey, id, "update", ends)] : [];
  return { change: { objects, values }, answer, added: objects.length, grows: growth(at.object, values) };
}

/** A delete merged in: an object created here is removed, a stored one's
 * object becomes a `delete` without values. An entity delete also removes
 * every staged relation at that entity. */
async function deleteMerge(
  changesetId: string,
  kind: StagedKind,
  typeKey: string,
  id: string,
  store: RuntimeStore,
): Promise<Merge> {
  const at = await target(changesetId, kind, typeKey, id, store);
  const cascaded = kind === "entity" ? await store.changesets().relationsAt(changesetId, id) : [];
  const answer: StagedAnswer = cascaded.length > 0 ? { id, cascaded } : { id };
  if (at.stored === null) return { change: { removeObjects: [id, ...cascaded] }, answer, added: 0, grows: 0 };
  const ends = kind === "relation" ? storedEnds(at.stored) : null;
  return {
    change: {
      removeObjects: cascaded,
      removeValues: (at.object?.values ?? []).map((value) => ({ objectId: id, propertyKey: value.propertyKey })),
      objects: [newObject(kind, typeKey, id, "delete", ends)],
    },
    answer,
    added: at.object === undefined ? 1 : 0,
    grows: 0,
  };
}

// ---------------------------------------------------------------------------
// Identity in a changeset
// ---------------------------------------------------------------------------

/**
 * The identity a staged entity create or update gives its entity, under
 * the definition now: a create's over its values, an update's over the
 * stored values with its own over them (a null removing one) when it
 * stages a value of an identity property. Null when it gives none: a
 * delete, a type without an identity, an update that stages no identity
 * property, or values that make no identity (a fault the replay reports).
 */
function givenIdentity(
  loaded: LoadedSchema,
  typeKey: string,
  action: StagedAction,
  staged: Row,
  stored: Row | null,
): string | null {
  if (action === "delete") return null;
  const properties = identityPropertiesOfType(loaded, typeKey);
  if (properties === null) return null;
  if (action === "update" && !properties.some((property) => Object.hasOwn(staged, property.key))) return null;
  return buildIdentity(properties, withoutNulls({ ...(stored ?? {}), ...staged })).identity;
}

/** The staged values of the object `id` once `change` is applied to
 * `object`, a null removing a key. */
function valuesAfter(object: StagedObjectRecord | undefined, id: string, change: ChangesetChange): Row {
  const values = new Map(Object.entries(object === undefined ? {} : valuesOf(object)));
  for (const removed of change.removeValues ?? []) if (removed.objectId === id) values.delete(removed.propertyKey);
  for (const value of change.values ?? []) if (value.objectId === id) values.set(value.propertyKey, value.value);
  return Object.fromEntries(values);
}

/** `values` without the keys whose value is null. */
function withoutNulls(values: Row): Row {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null));
}

/**
 * A merge into an entity, refused on the value faults of the identity it
 * leaves the entity with (an empty string, too long), as the immediate
 * write refuses them: a create's always, an update's when it stages a
 * value of an identity property. Uniqueness is left to the lock-free
 * pass. Nothing is kept of the identity: it is built again from the
 * values wherever it is needed.
 */
function withIdentity(loaded: LoadedSchema, at: Target, typeKey: string, id: string, merge: Merge): Merge {
  const properties = identityPropertiesOfType(loaded, typeKey);
  if (isEmpty(merge.change) || properties === null) return merge;
  const action = at.object?.action ?? "update";
  const staged = valuesAfter(at.object, id, merge.change);
  if (action === "create" || properties.some((property) => Object.hasOwn(staged, property.key))) {
    const errors: FieldErrors = {};
    entityIdentity(loaded, typeKey, withoutNulls({ ...(at.stored ?? {}), ...staged }), errors);
    refuseOn(errors);
  }
  return merge;
}

/** The 409 of an identity two entities have in a changeset's view. */
function ambiguous(changesetId: string, typeKey: string, identity: string): ConflictError {
  return new ConflictError(
    `More than one entity of type '${typeKey}' has the identity '${identity}' in changeset '${changesetId}'`,
  );
}

/**
 * The id of the entity of a type that has `identity` in the changeset's
 * view (`holdersInView`). Null when none has it, or the lens does not
 * show the type's whole identity; two that have it are a 409.
 */
async function stagedEntityOf(
  loaded: LoadedSchema,
  changesetId: string,
  typeKey: string,
  identity: string,
  store: RuntimeStore,
): Promise<string | null> {
  if ((loaded.scoped.entityTypes[typeKey]?.identityProperties ?? null) === null) return null;
  const found = await holdersInView(loaded, changesetId, typeKey, identity, store);
  if (found.size > 1) throw ambiguous(changesetId, typeKey, identity);
  const [id] = found;
  return id ?? null;
}

/**
 * The ids of the entities of a type that have `identity` in the
 * changeset's view: the stored entities with what this changeset
 * creates, updates and deletes over them, each identity built as the
 * commit would build it now: a create's from its values, an update's from
 * its values over the entity's current stored ones, under the current
 * definition. An entity it creates or renames is found by its new
 * identity; one it deletes or renames away is not found by its old one;
 * a live write to a value the changeset does not stage moves it.
 *
 * Only the candidates are read: the stored holder, and the staged objects
 * that stage a part of `identity` and no other value of an identity
 * property. Any other staged object either stages a value that builds
 * another identity or stages none, and then keeps its stored one.
 */
async function holdersInView(
  loaded: LoadedSchema,
  changesetId: string,
  typeKey: string,
  identity: string,
  store: RuntimeStore,
): Promise<Set<string>> {
  const properties = identityPropertiesOfType(loaded, typeKey);
  const values = properties === null ? null : identityValues(properties, identity);
  if (values === null) return new Set();
  const holder = await store.getEntityByIdentity(typeKey, identity);
  const candidates = await store.changesets().entityObjectsStaging(changesetId, typeKey, values);
  const holderId = holder === null ? null : (holder._id as string);
  let holderStaged = holderId !== null && candidates.some((object) => object.objectId === holderId);
  if (holderId !== null && !holderStaged) {
    const own = await store.changesets().objects(changesetId, [holderId]);
    candidates.push(...own);
    holderStaged = own.length > 0;
  }
  const updates = candidates.filter((object) => object.action === "update").map((object) => object.objectId);
  const stored = updates.length === 0 ? new Map<string, Row>() : await storedEntities(loaded, updates, store);
  const found = new Set<string>();
  for (const object of candidates) {
    if (identityAfter(loaded, object, stored.get(object.objectId)) === identity) found.add(object.objectId);
  }
  // Not staged: it keeps its stored identity.
  if (holderId !== null && !holderStaged) found.add(holderId);
  return found;
}

/**
 * The identity each staged entity object of a type leaves its entity
 * with (`identityAfter`), in one pass: the staged values of the identity
 * properties only, and the current stored rows of the updates that stage
 * one. An update that stages none keeps its stored identity, which a
 * caller reads from the stored holders; it maps to undefined.
 */
async function stagedIdentities(
  loaded: LoadedSchema,
  changesetId: string,
  typeKey: string,
  store: RuntimeStore,
): Promise<Map<string, string | null | undefined>> {
  const keys = (identityPropertiesOfType(loaded, typeKey) ?? []).map((property) => property.key);
  const objects = await store.changesets().entityObjectsKeyed(changesetId, typeKey, keys);
  const partial = objects.filter((object) => object.action === "update" && object.values.length > 0);
  const updates = partial.map((object) => object.objectId);
  const stored = updates.length === 0 ? new Map<string, Row>() : await storedEntities(loaded, updates, store);
  return new Map(
    objects.map((object) => {
      const keeps = object.action === "update" && object.values.length === 0;
      return [object.objectId, keeps ? undefined : identityAfter(loaded, object, stored.get(object.objectId))] as const;
    }),
  );
}

/** The identity a staged entity object leaves its entity with, `stored`
 * its target's current row (`holdersInView`): null for a delete, a
 * target gone, or values that make none. */
function identityAfter(loaded: LoadedSchema, object: StagedObjectRecord, stored: Row | undefined): string | null {
  if (object.kind !== "entity" || object.action === "delete") return null;
  if (object.action === "create") return givenIdentity(loaded, object.typeKey, "create", valuesOf(object), null);
  if (stored === undefined || stored._entityTypeKey !== object.typeKey) return null;
  const given = givenIdentity(loaded, object.typeKey, "update", valuesOf(object), stored);
  if (given !== null) return given;
  const touches = identityPropertiesOfType(loaded, object.typeKey)?.some((p) => Object.hasOwn(valuesOf(object), p.key));
  return touches === true || typeof stored._identity !== "string" ? null : stored._identity;
}

/** The parent end's entity type of a parent relation type; null for any
 * other relation type. */
function parentTypeOf(loaded: LoadedSchema, relationTypeKey: string): string | null {
  const rt = loaded.full.relationTypes[relationTypeKey];
  if (rt === undefined || rt.parent === null) return null;
  return rt.parent === "source" ? rt.fromEntityTypeKey : rt.toEntityTypeKey;
}

/**
 * A staged call with every entity it names by identity resolved to an id
 * in the changeset's view (`stagedEntityOf`), and the faults of the
 * fields that name them, joined to the call's own field errors: both or
 * neither of a pair under both of its fields; a relation end or a parent
 * no entity has as the immediate write's not found, under its identity
 * field. The target of an update, delete or document edit by identity
 * that is not found is the immediate route's 404.
 */
async function resolveWrite(
  loaded: LoadedSchema,
  changesetId: string,
  write: StagedWrite,
  store: RuntimeStore,
): Promise<Resolved> {
  const faults: FieldErrors = {};
  const byIdentity = async (typeKey: string | null, identity: string): Promise<string | null> =>
    typeKey === null ? null : stagedEntityOf(loaded, changesetId, typeKey, identity, store);
  switch (write.operation) {
    case "put_entity":
      return resolvePutEntity(loaded, changesetId, write, store);
    case "put_relation": {
      const { operation: _put, ...rest } = write;
      const created = await resolveWrite(loaded, changesetId, { ...rest, operation: "create_relation" }, store);
      if (created.write.operation !== "create_relation") return created;
      const rt = loaded.full.relationTypes[write.typeKey];
      if (rt !== undefined && loaded.scoped.relationTypes[write.typeKey] !== undefined && !rt.onePerPair) {
        throw new ValidationError("Instance validation failed", {
          fields: { type: `Relation type '${write.typeKey}' is not one per pair; a put needs one` },
        });
      }
      const { fromEntityId, toEntityId, properties, typeKey } = created.write;
      // An end not found is the create's fault, reported by its merge.
      const id =
        rt === undefined || Object.keys(created.faults).length > 0
          ? null
          : await pairHolderInView(changesetId, typeKey, fromEntityId, toEntityId, store);
      if (id === null) return { ...created, put: "create" };
      return { write: { operation: "update_relation", typeKey, id, properties }, faults: {}, put: "update" };
    }
    case "create_entity": {
      const request = write.parentRelation;
      if (request === null) return { write: { ...write, parentRelation: null }, faults };
      const { parentId, parentIdentity, ...rest } = request;
      let id = parentId ?? null;
      if (!exactlyOne(parentId, parentIdentity)) {
        exactlyOneFault(faults, "parentRelation.parentId", "parentRelation.parentIdentity");
        id = "";
      } else if (parentIdentity !== null && parentIdentity !== undefined) {
        const parentType = parentTypeOf(loaded, request.type);
        id = await byIdentity(parentType, parentIdentity);
        // A relation type that is no parent relation is reported on `type`.
        if (id === null && parentType !== null) {
          faults["parentRelation.parentIdentity"] = `Parent entity '${parentIdentity}' not found`;
        }
      }
      return { write: { ...write, parentRelation: { ...rest, parentId: id ?? "" } }, faults };
    }
    case "create_relation": {
      const rt = loaded.full.relationTypes[write.typeKey];
      const end = async (
        idField: "fromEntityId" | "toEntityId",
        identityField: "fromEntityIdentity" | "toEntityIdentity",
        type: string | null,
        label: string,
      ): Promise<string> => {
        const id = write[idField];
        const identity = write[identityField];
        if (!exactlyOne(id, identity)) {
          exactlyOneFault(faults, idField, identityField);
          return "";
        }
        if (id !== null && id !== undefined) return id;
        const found = await byIdentity(type, identity!);
        if (found === null) faults[identityField] = `${label} entity '${identity}' not found`;
        return found ?? "";
      };
      const fromEntityId = await end("fromEntityId", "fromEntityIdentity", rt?.fromEntityTypeKey ?? null, "Source");
      const toEntityId = await end("toEntityId", "toEntityIdentity", rt?.toEntityTypeKey ?? null, "Target");
      const { fromEntityIdentity: _from, toEntityIdentity: _to, ...rest } = write;
      return { write: { ...rest, fromEntityId, toEntityId }, faults };
    }
    case "update_entity":
    case "delete_entity":
    case "edit_document": {
      const { id, identity, ...rest } = write;
      if (!exactlyOne(id, identity)) {
        const errors: FieldErrors = {};
        exactlyOneFault(errors, "id", "identity");
        throw new ValidationError("Instance validation failed", { fields: errors });
      }
      if (id !== null && id !== undefined) return { write: { ...rest, id }, faults };
      if (loaded.scoped.entityTypes[write.typeKey] === undefined) {
        throw new NotFoundError(`Entity type '${write.typeKey}' not found`);
      }
      const found = await byIdentity(write.typeKey, identity!);
      if (found === null) throw new NotFoundError(`Entity '${identity}' not found`);
      return { write: { ...rest, id: found }, faults };
    }
    default:
      return { write, faults };
  }
}

/**
 * A put of an entity: its identity built from its values as a create
 * would build it, then the entity that has it in the changeset's view
 * (`stagedEntityOf`) updated, or else a new one created. A type the lens
 * shows no identity of, or values that build none, is refused.
 */
async function resolvePutEntity(
  loaded: LoadedSchema,
  changesetId: string,
  write: Extract<StagedWrite, { operation: "put_entity" }>,
  store: RuntimeStore,
): Promise<Resolved> {
  const { typeKey, properties } = write;
  const ids = { entityId: randomUUID(), relationId: randomUUID() };
  // The type's 404 first, as the create's.
  const { errors, write: prepared } = prepareCreateEntity(loaded, typeKey, properties, null, ids);
  const keys = (loaded.scoped.entityTypes[typeKey]?.identityProperties ?? null) === null
    ? null
    : (identityPropertiesOfType(loaded, typeKey) ?? []).map((property) => property.key);
  if (keys === null) {
    throw new ValidationError("Instance validation failed", {
      fields: { type: `Entity type '${typeKey}' has no identity this lens shows; a put names its entity by identity` },
    });
  }
  const identity = prepared.entity.identity;
  if (identity === null) {
    const fields = Object.fromEntries(Object.entries(errors).filter(([key]) => keys.includes(key)));
    throw new ValidationError("Instance validation failed", { fields: Object.keys(fields).length > 0 ? fields : errors });
  }
  const id = await stagedEntityOf(loaded, changesetId, typeKey, identity, store);
  if (id === null) {
    return { write: { operation: "create_entity", typeKey, properties, parentRelation: null }, faults: {}, put: "create" };
  }
  return { write: { operation: "update_entity", typeKey, id, properties }, faults: {}, put: "update" };
}

/**
 * The relation of a one-per-pair type that links the pair in the
 * changeset's view: a stored one this changeset does not delete, or one it
 * creates; null when none does. Two that do (stored data from before the
 * rule, or creates the commit will refuse) are a 409.
 */
async function pairHolderInView(
  changesetId: string,
  typeKey: string,
  fromId: string,
  toId: string,
  store: RuntimeStore,
): Promise<string | null> {
  const pairs = [{ fromId, toId }];
  const staged = await store.changesets().relationObjectsAt(changesetId, typeKey, pairs);
  const deleted = new Set(staged.filter((object) => object.action === "delete").map((object) => object.objectId));
  const holders = new Set<string>();
  for (const relation of await store.relationsOfPairs(typeKey, pairs)) {
    if (!deleted.has(relation.id)) holders.add(relation.id);
  }
  for (const object of staged) if (object.action === "create") holders.add(object.objectId);
  if (holders.size > 1) {
    throw new ConflictError(
      `More than one relation of type '${typeKey}' links this source and target in changeset '${changesetId}'`,
    );
  }
  const [id] = holders;
  return id ?? null;
}

/** One staged call as a change of the set, after its checks. */
async function mergeOf(
  loaded: LoadedSchema,
  changesetId: string,
  write: ResolvedWrite,
  faults: FieldErrors,
  store: RuntimeStore,
): Promise<Merge> {
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
      refuseOn({ ...errors, ...faults });
      const objects = [newObject("entity", write.typeKey, ids.entityId, "create")];
      const entityValues = sent(prepared.entity.properties, write.properties);
      const values = Object.entries(entityValues).map(([key, value]) => newValue(ids.entityId, key, value, null));
      const input = write.parentRelation;
      const answer: StagedAnswer = { id: ids.entityId };
      if (input !== null && prepared.parent !== null) {
        // Oriented by the relation type's parent end.
        const r = prepared.parent.relation;
        objects.push(newObject("relation", input.type, ids.relationId, "create", [r.fromEntityId, r.toEntityId]));
        for (const [key, value] of Object.entries(sent(r.properties, input.properties ?? {}))) {
          values.push(newValue(ids.relationId, key, value, null));
        }
        answer.relation = { id: ids.relationId };
      }
      return { change: { objects, values }, answer, added: objects.length, grows: growth(undefined, values) };
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
      refuseOn({ ...errors, ...faults });
      const values = Object.entries(sent(prepared.properties, write.properties)).map(([key, value]) =>
        newValue(relationId, key, value, null),
      );
      return {
        change: {
          objects: [newObject("relation", write.typeKey, relationId, "create", [write.fromEntityId, write.toEntityId])],
          values,
        },
        answer: { id: relationId },
        added: 1,
        grows: growth(undefined, values),
      };
    }
    case "update_entity": {
      const { errors, write: prepared } = prepareUpdateEntity(loaded, write.typeKey, write.id, write.properties);
      refuseOn(errors);
      const at = await target(changesetId, "entity", write.typeKey, write.id, store);
      const defs = loaded.full.entityTypes[write.typeKey]?.properties ?? {};
      const merge = patchMerge(at, "entity", write.typeKey, write.id, patchOf(prepared), defs);
      return withIdentity(loaded, at, write.typeKey, write.id, merge);
    }
    case "update_relation": {
      const { errors, write: prepared } = prepareUpdateRelation(loaded, write.typeKey, write.id, write.properties);
      refuseOn(errors);
      const at = await target(changesetId, "relation", write.typeKey, write.id, store);
      const defs = loaded.full.relationTypes[write.typeKey]?.properties ?? {};
      return patchMerge(at, "relation", write.typeKey, write.id, patchOf(prepared), defs);
    }
    case "delete_entity":
      prepareDeleteEntity(loaded, write.typeKey, write.id);
      return deleteMerge(changesetId, "entity", write.typeKey, write.id, store);
    case "delete_relation":
      prepareDeleteRelation(loaded, write.typeKey, write.id);
      return deleteMerge(changesetId, "relation", write.typeKey, write.id, store);
    case "edit_document": {
      // The document read's 404s, then the edit on the staged text, or
      // else the stored one ("" on a create without it).
      const type = loaded.scoped.entityTypes[write.typeKey];
      if (type === undefined) throw new NotFoundError(`Entity type '${write.typeKey}' not found`);
      const key = write.propertyKey;
      if (type.properties[key]?.dataType !== "document") {
        throw new NotFoundError(`Document property '${key}' not found on entity type '${write.typeKey}'`);
      }
      const at = await target(changesetId, "entity", write.typeKey, write.id, store);
      const staged = at.object?.values.find((value) => value.propertyKey === key);
      const text = staged !== undefined ? staged.value : at.stored?.[key];
      const edited = applyDocumentEdit(key, typeof text === "string" ? text : "", write.edit);
      const defs = loaded.full.entityTypes[write.typeKey]?.properties ?? {};
      const merge = patchMerge(at, "entity", write.typeKey, write.id, { [key]: edited.value }, defs);
      return { ...merge, answer: { id: write.id, ...edited.answer } };
    }
  }
}

function isEmpty(change: ChangesetChange): boolean {
  return Object.values(change).every((part: unknown[] | undefined) => part === undefined || part.length === 0);
}

/** The draft a staging request stages into, as of its last change, and
 * the bytes of its staged values once read. */
interface Staging {
  changeset: ChangesetRecord;
  bytes: number | null;
}

/** A staged call's checks and merge (see the header): what it changes,
 * and its answer. Nothing is applied yet. */
async function mergeOne(
  loaded: LoadedSchema,
  changesetId: string,
  write: StagedWrite,
  store: RuntimeStore,
): Promise<Merge> {
  const resolved = await resolveWrite(loaded, changesetId, write, store);
  const merge = await mergeOf(loaded, changesetId, resolved.write, resolved.faults, store);
  return resolved.put === undefined ? merge : { ...merge, answer: { ...merge.answer, action: resolved.put } };
}

/** Apply a merge to the draft after the changeset's limits: a full
 * changeset is a 409. A merge that changes nothing applies nothing. */
async function applyMerge(
  loaded: LoadedSchema,
  rulesetKey: string | null,
  at: Staging,
  merge: Merge,
  store: RuntimeStore,
): Promise<void> {
  const { id, objectCount } = at.changeset;
  const maxObjects = settings.CHANGESET_MAX_OBJECTS;
  if (merge.added > 0 && objectCount + merge.added > maxObjects) {
    throw new ConflictError(`Changeset '${id}' is full: at most ${maxObjects} staged objects`);
  }
  const maxBytes = settings.CHANGESET_MAX_BYTES;
  if (merge.grows > 0) {
    at.bytes ??= await store.changesets().stagedBytes(id);
    if (at.bytes + merge.grows > maxBytes) {
      throw new ConflictError(`Changeset '${id}' is full: at most ${maxBytes} bytes of staged values`);
    }
  }
  if (isEmpty(merge.change)) return;
  at.changeset = await applyChange(loaded, rulesetKey, at.changeset, merge.change, store);
  if (at.bytes !== null) at.bytes += merge.grows;
}

/**
 * Stage one call: its checks (see the header), then its merge into the
 * set, applied with a compare-and-set on the version read; a call that
 * changes nothing applies nothing. Answers the id of its object (see
 * `StagedAnswer`). A full changeset, a change in between, or one a commit
 * holds is a 409.
 */
export async function stage(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  write: StagedWrite,
  store: RuntimeStore,
): Promise<StagedAnswer> {
  const loaded = await loadSchema(lensKey, store);
  const changeset = await loadDraft(loaded, rulesetKey, changesetId, store);
  // The anchor deleted, or at an entity the lens hides: refused as every write.
  await AnchorGuard.checkStaging(rulesetKey, loaded, store);

  const merge = await mergeOne(loaded, changeset.id, write, store);
  await applyMerge(loaded, rulesetKey, { changeset, bytes: null }, merge, store);
  return merge.answer;
}

/** One item of a staging request that failed: its index in the list, and
 * the error it alone would answer. */
export interface ItemFault {
  item: number;
  code: "VALIDATION_ERROR" | "RESOURCE_NOT_FOUND" | "RESOURCE_CONFLICT";
  message: string;
  details?: Record<string, unknown>;
}

/** The fault of an item's own error; null for any other error, which
 * fails the request as it is. */
function itemFault(item: number, error: unknown): ItemFault | null {
  const code =
    error instanceof ValidationError
      ? "VALIDATION_ERROR"
      : error instanceof NotFoundError
        ? "RESOURCE_NOT_FOUND"
        : error instanceof ConflictError
          ? "RESOURCE_CONFLICT"
          : null;
  if (code === null) return null;
  const details = (error as ValidationError).details;
  return { item, code, message: (error as Error).message, ...(details === null ? {} : { details }) };
}

/**
 * Stage a list of calls, in list order and whole or not at all, in one
 * transaction: each item sees what the items before it staged, so a later
 * one may name an entity an earlier one creates. Every item is checked; if
 * any fails, nothing is staged and the 422 names each failed item by its
 * index (`ItemFault`). The changeset's own refusals — not found,
 * submitted, full, changed in between — fail the request as for one call.
 * Answers each item's answer, in item order.
 */
export async function stageBatch(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  writes: StagedWrite[],
  store: RuntimeStore,
): Promise<StagedAnswer[]> {
  const loaded = await loadSchema(lensKey, store);
  const changeset = await loadDraft(loaded, rulesetKey, changesetId, store);
  await AnchorGuard.checkStaging(rulesetKey, loaded, store);
  return store.transaction(loaded.design, async (bound) => {
    const at: Staging = { changeset, bytes: null };
    const answers: StagedAnswer[] = [];
    const faults: ItemFault[] = [];
    for (const [item, write] of writes.entries()) {
      let merge: Merge;
      try {
        merge = await mergeOne(loaded, changeset.id, write, bound);
      } catch (error) {
        const fault = itemFault(item, error);
        if (fault === null) throw error;
        faults.push(fault);
        continue;
      }
      // Applied even after a failed item, so that the items after it are
      // checked against what the items before staged; the transaction
      // rolls it all back.
      await applyMerge(loaded, rulesetKey, at, merge, bound);
      answers.push(merge.answer);
    }
    if (faults.length > 0) {
      throw new ValidationError(`${faults.length} of ${writes.length} items failed; nothing was staged`, {
        items: faults,
      });
    }
    return answers;
  });
}

// ---------------------------------------------------------------------------
// Unstage, cut, rebase, discard
// ---------------------------------------------------------------------------

/** The staged object `objectId` of a changeset; not staged is a 404. */
async function stagedObject(changesetId: string, objectId: string, store: RuntimeStore): Promise<StagedObjectRecord> {
  const [object] = await store.changesets().objects(changesetId, [objectId]);
  if (object === undefined) {
    throw new NotFoundError(`Object '${objectId}' is not staged in changeset '${changesetId}'`);
  }
  return object;
}

function noValue(changesetId: string, objectId: string, propertyKey: string): NotFoundError {
  return new NotFoundError(`No value of '${propertyKey}' is staged for object '${objectId}' in changeset '${changesetId}'`);
}

/**
 * Take one staged object out with its values; with `propertyKey`, cut
 * only that value out, and an `update` left without values goes too.
 * Nothing else changes: what depends on it shows as a marker. Unstaging a
 * delete brings nothing back. Allowed when the anchor is deleted.
 */
export async function unstage(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  objectId: string,
  propertyKey: string | null,
  store: RuntimeStore,
): Promise<void> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadDraft(loaded, rulesetKey, changesetId, store);
  const object = await stagedObject(record.id, objectId, store);
  let change: ChangesetChange = { removeObjects: [object.objectId] };
  if (propertyKey !== null) {
    if (!object.values.some((value) => value.propertyKey === propertyKey)) {
      throw noValue(changesetId, objectId, propertyKey);
    }
    const last = object.action === "update" && object.values.length === 1;
    if (!last) change = { removeValues: [{ objectId: object.objectId, propertyKey }] };
  }
  await applyChange(loaded, rulesetKey, record, change, store);
}

/**
 * Accept the stored values now: the before of each named value of an
 * update of a stored object (default: all of them) becomes the stored
 * value now, and the staged values stay. Any other action is a 409, a
 * key without a staged value a 404, and so is a target gone. Answers the
 * object as the review shows it.
 */
export async function rebase(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  objectId: string,
  propertyKeys: string[] | null,
  store: RuntimeStore,
): Promise<StagedObjectView> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadDraft(loaded, rulesetKey, changesetId, store);
  const object = await stagedObject(record.id, objectId, store);
  if (object.action !== "update") {
    throw new ConflictError(`Only an update of a stored object can be rebased; this object is a ${object.action}`);
  }
  const keys = propertyKeys ?? object.values.map((value) => value.propertyKey);
  const staged = new Map(object.values.map((value) => [value.propertyKey, value] as const));
  for (const key of keys) {
    if (!staged.has(key)) throw noValue(changesetId, objectId, key);
  }
  const entity = object.kind === "entity";
  const stored = entity
    ? await store.getEntity(object.typeKey, object.objectId)
    : await store.getRelation(object.typeKey, object.objectId);
  if (stored === null) throw missing(object.kind, object.objectId);
  const defs = (entity ? loaded.full.entityTypes : loaded.full.relationTypes)[object.typeKey]?.properties ?? {};
  const values = [...new Set(keys)].map((key) =>
    newValue(object.objectId, key, staged.get(key)!.value, recordedBefore(stored, key, defs)),
  );
  await applyChange(loaded, rulesetKey, record, { values }, store);
  const [view] = await reviewOf(loaded, record.id, await store.changesets().objects(record.id, [objectId]), store);
  return view!;
}

/** Delete a draft changeset and its staged objects. A submitted one is
 * refused; the store deletes a draft one only, so a submit landing after
 * the read is refused too. */
export async function discardChangeset(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  store: RuntimeStore,
): Promise<void> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, rulesetKey, changesetId, store);
  if (record.submittedAt === null && (await store.changesets().discard(record.id))) return;
  const now = await store.changesets().get(record.id, loaded.scoped.lensId, rulesetKey);
  throw now === null || now.submittedAt === null ? notFound(changesetId) : isSubmitted(changesetId);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The review read: the changeset and one page of its staged objects by
 * first touch, each with names resolved, its values with `before`,
 * `current` and `after`, and the markers the lock-free pass finds on it.
 * The page's objects are judged alone, as `getStagedEntity` judges one:
 * an object's markers depend on nothing else in the changeset but the
 * objects at its relation ends.
 */
export async function getChangeset(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  offset: number,
  limit: number,
  store: RuntimeStore,
): Promise<ChangesetView & { offset: number; limit: number; objects: StagedObjectView[] }> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, rulesetKey, changesetId, store);
  const objects = await reviewOf(loaded, record.id, await store.changesets().page(record.id, offset, limit), store);
  return { ...toView(record), offset, limit, objects };
}

/**
 * The text a commit of this changeset would leave in one document
 * property: its staged value, sliced as the document read slices
 * (`documentSlice`); a staged null is the empty text. Through the lens as
 * every review read: a type or property it hides is not found, and so is
 * a property with no staged value, or one of an entity this changeset
 * deletes.
 */
export async function getStagedDocument(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  entityTypeKey: string,
  entityId: string,
  propertyKey: string,
  offset: number,
  limit: number | null,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, rulesetKey, changesetId, store);
  const type = loaded.scoped.entityTypes[entityTypeKey];
  if (type === undefined) throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  if (type.properties[propertyKey]?.dataType !== "document") {
    throw new NotFoundError(`Document property '${propertyKey}' not found on entity type '${entityTypeKey}'`);
  }
  const [object] = await store.changesets().objects(record.id, [entityId]);
  const own = object?.kind === "entity" && object.typeKey === entityTypeKey ? object : undefined;
  if (own?.action === "delete") {
    throw new NotFoundError(`Changeset '${changesetId}' deletes entity '${entityId}': a commit leaves no '${propertyKey}'`);
  }
  const staged = own?.values.find((value) => value.propertyKey === propertyKey);
  if (staged === undefined) {
    throw new NotFoundError(`Changeset '${changesetId}' stages no '${propertyKey}' of entity '${entityId}'`);
  }
  return documentSlice(propertyKey, typeof staged.value === "string" ? staged.value : "", offset, limit);
}

/** One entity as a commit of this changeset would leave it, and its
 * staged object. */
export interface StagedEntityView {
  /** The stored entity, or the one this changeset creates, through the
   * lens, with its staged values applied. */
  entity: Row;
  /** Whether this changeset deletes it. */
  deleted: boolean;
  /** Its staged object as the review shows it; null when none is staged. */
  object: StagedObjectView | null;
}

/**
 * One entity as a commit of this changeset would leave it: the stored
 * entity, or the one this changeset creates, with its staged values
 * applied (a null removes a key) and no defaults (the commit applies
 * them), as the entity read shows it through the lens, documents as stubs;
 * `deleted` when the changeset deletes it. Beside it, its staged object as
 * the review read shows it. Staged relations at it are not part of it.
 * Not found: a type the lens hides, or an entity neither stored nor
 * created by this changeset.
 */
export async function getStagedEntity(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  entityTypeKey: string,
  entityId: string,
  store: RuntimeStore,
): Promise<StagedEntityView> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, rulesetKey, changesetId, store);
  const type = loaded.scoped.entityTypes[entityTypeKey];
  if (type === undefined) throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);

  const [found] = await store.changesets().objects(record.id, [entityId]);
  const object = found?.kind === "entity" && found.typeKey === entityTypeKey ? found : undefined;
  const stored = await store.getEntity(entityTypeKey, entityId);
  if (stored === null && object?.action !== "create") throw new NotFoundError(`Entity '${entityId}' not found`);

  const entity: Row = stored === null ? { _id: entityId, _entityTypeKey: entityTypeKey } : { ...stored };
  for (const { propertyKey, value } of object?.values ?? []) {
    // A staged document is measured afresh, not by the stored length.
    delete entity[docLengthKey(propertyKey)];
    if (value === null) delete entity[propertyKey];
    else entity[propertyKey] = value;
  }
  const identity = object === undefined ? null : givenIdentity(loaded, entityTypeKey, object.action, valuesOf(object), stored);
  if (identity !== null) entity._identity = identity;
  // Values that make no identity leave none, never the stored one.
  else if (object !== undefined && stagesIdentity(loaded, object)) delete entity._identity;
  const [view] = object === undefined ? [] : await reviewOf(loaded, record.id, [object], store);
  return { entity: filterEntityProperties(entity, type), deleted: object?.action === "delete", object: view ?? null };
}

/** `getStagedEntity` of the entity a changeset's view gives `identity`
 * (`stagedEntityOf`): none is not found, two a 409. */
export async function getStagedEntityByIdentity(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  entityTypeKey: string,
  identity: string,
  store: RuntimeStore,
): Promise<StagedEntityView> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, rulesetKey, changesetId, store);
  if (loaded.scoped.entityTypes[entityTypeKey] === undefined) {
    throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  }
  const id = await stagedEntityOf(loaded, record.id, entityTypeKey, identity, store);
  if (id === null) throw new NotFoundError(`Entity '${identity}' not found`);
  return getStagedEntity(lensKey, rulesetKey, changesetId, entityTypeKey, id, store);
}

/**
 * The lens's changesets: through the plain lens URL every one, through a
 * ruleset URL only its ruleset's; by number, lowest first. Expired draft
 * changesets are swept first. `types` applies the lens as it is now.
 */
export async function listChangesets(
  lensKey: string,
  rulesetKey: string | null,
  store: RuntimeStore,
): Promise<ChangesetListItem[]> {
  const loaded = await loadSchema(lensKey, store);
  await checkRulesetExists(rulesetKey, store);
  const changesets = store.changesets();
  await changesets.sweep(IDLE_MS);
  const lens = loaded.scoped;
  const shown = (key: string): boolean => Object.hasOwn(lens.entityTypes, key) || Object.hasOwn(lens.relationTypes, key);
  return (await changesets.list(lens.lensId, rulesetKey)).map((summary) => {
    const types = summary.typeKeys.filter(shown);
    return {
      id: summary.id,
      number: summary.number,
      state: summary.submittedAt === null ? "draft" : "submitted",
      version: summary.version,
      note: summary.note,
      ruleset: summary.rulesetKey,
      objectCount: summary.objectCount,
      operations: summary.operations,
      types,
      notVisible: summary.typeKeys.length - types.length,
      createdAt: summary.createdAt,
      lastChangeAt: summary.lastChangeAt,
      submittedAt: summary.submittedAt,
    };
  });
}

/** How many changesets a lens delete takes with it, counted before the
 * delete; an expired draft changeset is swept first. */
export async function lensChangesetCount(lensId: string, store: RuntimeStore): Promise<number> {
  const changesets = store.changesets();
  await changesets.sweep(IDLE_MS);
  return (await changesets.list(lensId, null)).length;
}

// ---------------------------------------------------------------------------
// Submit, unsubmit
// ---------------------------------------------------------------------------

/**
 * Submit a draft changeset: freeze it and hand it over, with the note
 * given (absent, the note stays). Already submitted, or a changeset whose
 * ruleset's anchor is deleted or at an entity the lens hides, is a 409.
 * The lock-free pass runs with no lock and no transaction; its faults are
 * a 422 and the changeset stays a draft. Clean, a compare-and-set on the
 * version the pass saw: a change meanwhile is a 409.
 */
export async function submitChangeset(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  note: string | null | undefined,
  store: RuntimeStore,
): Promise<ChangesetView> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, rulesetKey, changesetId, store);
  if (record.submittedAt !== null) throw new ConflictError(`Changeset '${changesetId}' is already submitted`);
  const valid = validNote(note);
  if (record.rulesetKey !== null) {
    // The stored ruleset, whatever URL the call came through. A deleted one
    // is left to the commit (`ruleset_gone`).
    const anchor = await store.rulesets().get(record.rulesetKey);
    const refusal = anchor === null ? null : changesetAnchorRefusal(record.rulesetKey, anchor, loaded);
    if (refusal !== null) throw new ConflictError(refusal.message);
  }
  const pass = await lockFreePass(loaded, record.id, store);
  if (pass.faults.length > 0) {
    throw violationsError("The changeset was not submitted; it stays a draft", pass.faults);
  }
  const submitted = await store.changesets().submit(record.id, record.version, valid ?? record.note);
  if (submitted === null) {
    if ((await store.changesets().get(record.id, loaded.scoped.lensId, rulesetKey)) === null) throw notFound(changesetId);
    throw new ConflictError(`Changeset '${changesetId}' changed during the submit; try again`);
  }
  return toView(submitted);
}

/**
 * A submitted changeset back to draft, through any URL that reaches it,
 * one whose anchor is deleted included. The note is required: it replaces
 * the stored one. A draft changeset is a 409.
 */
export async function unsubmitChangeset(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  note: string | null | undefined,
  store: RuntimeStore,
): Promise<ChangesetView> {
  const loaded = await loadSchema(lensKey, store);
  const record = await loadChangeset(loaded, rulesetKey, changesetId, store);
  const valid = validNote(note);
  if (valid === null || valid.trim() === "") {
    throw new ValidationError("Changeset validation failed", { fields: { note: "A note is required to unsubmit" } });
  }
  const notSubmitted = new ConflictError(`Changeset '${changesetId}' is not submitted`);
  if (record.submittedAt === null) throw notSubmitted;
  const draft = await store.changesets().unsubmit(record.id, valid);
  if (draft === null) {
    if ((await store.changesets().get(record.id, loaded.scoped.lensId, rulesetKey)) === null) throw notFound(changesetId);
    throw notSubmitted;
  }
  return toView(draft);
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/** At most this many commits run at once in one process. */
export const MAX_RUNNING_COMMITS = 1;
/** A rejection names at most this many violations. */
export const MAX_VIOLATIONS = 100;
/** The staged objects are read in pages of this many. */
const READ_PAGE = 500;

let runningCommits = 0;

/** One reason a commit is rejected: on a staged object, and on one of its
 * properties, or on the changeset as a whole (`object` null). */
export interface Violation {
  object: string | null;
  property?: string;
  kind: string;
  message: string;
}

/** What applying the staged objects leaves for commit validation. */
export interface Applied {
  /** The staged objects applied. */
  applied: number;
  /** The ids of staged deletes that found nothing: done. */
  alreadyGone: string[];
  /** Each staged entity delete's children over the parent relations,
   * read with the entity locked, just before its delete. */
  deletedChildren: { objectId: string; children: ParentLink[] }[];
  /** The identity each staged entity create, and each update that
   * rebuilt one, gave its entity. */
  identities: { objectId: string; typeKey: string; identity: string }[];
  /** The object that could not be applied; nothing after it ran. */
  fault: Violation | null;
}

/** The answer of a commit. */
export interface CommitAnswer {
  committed: number;
  alreadyGone: string[];
}

/** The answer of a check that passed: what the commit would answer, on
 * the version checked. */
export interface CheckAnswer extends CommitAnswer {
  version: number;
}

/*
 * The texts of markers and violations say what is wrong in words a person
 * reads: no id and no fix. The object they sit on goes unnamed; another
 * entity is named by its role (the source or target end). Type, property,
 * lens and ruleset keys stay.
 */

const DRIFTED = "Changed since it was staged";
const DELETED_SINCE = "Deleted since it was staged";
const END_GONE = "The source or target end no longer exists";

/** An end of a staged relation that is neither stored nor created in
 * this changeset. */
function neitherStored(role: string): string {
  return `${role} is neither stored nor created in this changeset`;
}

/** A staged object that cannot be applied; its message names only what
 * the caller sent. */
class ApplyFault extends Error {
  constructor(
    message: string,
    readonly kind = "replay",
  ) {
    super(message);
  }
}

/** Thrown inside the commit transaction to roll it back with these. */
class CommitRejected extends Error {
  constructor(readonly violations: Violation[]) {
    super("Commit rejected");
  }
}

/** Thrown inside a check's transaction where the commit would delete the
 * changeset: it rolls everything back and carries the answer out. */
class CheckPassed extends Error {
  constructor(readonly answer: CommitAnswer) {
    super("Check passed");
  }
}

/** The one-line text of field errors; null when there are none. */
function fieldFaults(errors: FieldErrors): string | null {
  const fields = Object.entries(errors);
  if (fields.length === 0) return null;
  return `Instance validation failed: ${fields.map(([key, message]) => `${key}: ${message}`).join("; ")}`;
}

function faultOn(errors: FieldErrors): void {
  const message = fieldFaults(errors);
  if (message !== null) throw new ApplyFault(message);
}

/** The order in which a commit applies the staged objects. */
const PHASES: readonly (readonly [StagedKind, StagedAction])[] = [
  ["entity", "create"],
  ["entity", "update"],
  ["relation", "delete"],
  ["relation", "create"],
  ["relation", "update"],
  ["entity", "delete"],
];

/** The most staged objects one batch write of the commit carries. */
const WRITE_BATCH = 1000;

/** A staged object's fault while its batch is prepared or written. */
class ObjectFault extends Error {
  constructor(
    readonly object: StagedObjectRecord,
    readonly error: Error,
  ) {
    super(error.message);
  }
}

/** `work` for one object, its fault carried with it. */
function forObject<T>(object: StagedObjectRecord, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof ApplyFault || error instanceof NotFoundError) throw new ObjectFault(object, error);
    throw error;
  }
}

/** The first object of `batch` the store did not write: `fault` on it. */
function firstUnwritten(batch: StagedObjectRecord[], written: string[], fault: () => ApplyFault): void {
  const done = new Set(written);
  const missed = batch.find((object) => !done.has(object.objectId));
  if (missed !== undefined) throw new ObjectFault(missed, fault());
}

/**
 * One batch of staged objects of one phase, each prepared as the
 * immediate write prepares it, then written through the store's batch
 * write of the phase with its search work. The first object that cannot
 * be applied, in staging order, is thrown as an `ObjectFault`; a fault of
 * the batch write itself is laid on its first object.
 */
async function applyBatch(
  loaded: LoadedSchema,
  plan: (change: SearchChange) => SearchWritePlan | null,
  readings: Record<string, ParentEnd>,
  kind: StagedKind,
  action: StagedAction,
  batch: StagedObjectRecord[],
  bound: RuntimeStore,
  applied: Applied,
): Promise<void> {
  const write = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ApplyFault || error instanceof NotFoundError) throw new ObjectFault(batch[0]!, error);
      throw error;
    }
  };
  if (kind === "entity" && action === "create") {
    const rows = batch.map((object) =>
      forObject(object, () => {
        const { errors, write: prepared } = prepareCreateEntity(loaded, object.typeKey, valuesOf(object), null, {
          entityId: object.objectId,
          relationId: randomUUID(),
        });
        faultOn(errors);
        const e = prepared.entity;
        return { ...e, search: plan(e.change) };
      }),
    );
    await write(() => bound.createEntities(rows));
    for (const row of rows) {
      if (row.identity !== null) applied.identities.push({ objectId: row.entityId, typeKey: row.entityTypeKey, identity: row.identity });
    }
    return;
  }
  if (kind === "entity" && action === "update") {
    const prepared = batch.flatMap((object) =>
      forObject(object, () => {
        const { errors, write: update } = prepareUpdateEntity(loaded, object.typeKey, object.objectId, valuesOf(object));
        faultOn(errors);
        return update === null ? [] : [{ object, update }];
      }),
    );
    // The identity rebuilt under the definition now, from the rows as locked.
    const rebuilds = prepared.filter(({ object, update }) =>
      touchesIdentity(identityPropertiesOfType(loaded, object.typeKey), update),
    );
    const stored =
      rebuilds.length === 0 ? {} : await bound.getEntitiesByIds(rebuilds.map(({ object }) => object.objectId), {});
    const rows = prepared.map(({ object, update }) =>
      forObject(object, () => {
        let identity: string | undefined;
        if (rebuilds.some((rebuild) => rebuild.object === object)) {
          const row = stored[object.objectId];
          if (row === undefined || row._entityTypeKey !== object.typeKey) throw new ApplyFault(DELETED_SINCE);
          const errors: FieldErrors = {};
          identity = updatedIdentity(loaded, object.typeKey, row, update, errors);
          faultOn(errors);
        }
        return { ...update, identity, search: plan(update.change) };
      }),
    );
    const written = await write(() => bound.updateEntities(rows));
    firstUnwritten(
      prepared.map(({ object }) => object),
      written,
      () => new ApplyFault(DELETED_SINCE),
    );
    for (const row of rows) {
      if (row.identity !== undefined) applied.identities.push({ objectId: row.entityId, typeKey: row.entityTypeKey, identity: row.identity });
    }
    return;
  }
  if (kind === "entity") {
    const rows = batch.map((object) =>
      forObject(object, () => {
        const prepared = prepareDeleteEntity(loaded, object.typeKey, object.objectId);
        return { typeKey: prepared.entityTypeKey, id: prepared.entityId, search: plan(prepared.change) };
      }),
    );
    // Delete capture: X locked, so no child can attach until COMMIT, and
    // the children recorded before the cascade erases them.
    const children = await bound.childrenOf(rows.map((row) => row.id), readings, true);
    for (const object of batch) {
      const own = children.filter((link) => link.parentId === object.objectId);
      applied.deletedChildren.push({ objectId: object.objectId, children: own });
    }
    // As the immediate delete: never remove a relation the lens hides.
    for (const object of batch) {
      if (await hasHiddenRelations(loaded, object.typeKey, object.objectId, bound)) {
        throw new ObjectFault(object, new ApplyFault(HIDDEN_RELATIONS_MESSAGE, "hidden_relations"));
      }
    }
    const written = new Set(await write(() => bound.deleteEntities(rows)));
    for (const row of rows) if (!written.has(row.id)) applied.alreadyGone.push(row.id);
    return;
  }
  if (action === "create") {
    const rows = batch.map((object) =>
      forObject(object, () => {
        const { errors, write: prepared } = prepareCreateRelation(
          loaded,
          object.typeKey,
          object.fromId!,
          object.toId!,
          valuesOf(object),
          object.objectId,
        );
        faultOn(errors);
        return { ...prepared, search: plan(prepared.change) };
      }),
    );
    // Relation deletes ran before, so a pair this changeset frees is free.
    const pairKey = (fromId: string, toId: string): string => `${fromId} ${toId}`;
    for (const typeKey of new Set(batch.map((object) => object.typeKey))) {
      if (loaded.full.relationTypes[typeKey]?.onePerPair !== true) continue;
      const ofType = batch.filter((object) => object.typeKey === typeKey);
      const held = await bound.lockPairs(
        typeKey,
        ofType.map((object) => ({ fromId: object.fromId!, toId: object.toId! })),
      );
      const taken = new Set(held.map((relation) => pairKey(relation.fromId, relation.toId)));
      const first = ofType.find((object) => taken.has(pairKey(object.fromId!, object.toId!)));
      if (first !== undefined) throw new ObjectFault(first, new ApplyFault(duplicatePair(typeKey), "duplicate_pair"));
    }
    const written = await write(() => bound.createRelations(rows));
    firstUnwritten(batch, written, () => new ApplyFault(END_GONE));
    return;
  }
  if (action === "update") {
    const prepared = batch.flatMap((object) =>
      forObject(object, () => {
        const { errors, write: update } = prepareUpdateRelation(loaded, object.typeKey, object.objectId, valuesOf(object));
        faultOn(errors);
        return update === null ? [] : [{ object, row: { ...update, search: plan(update.change) } }];
      }),
    );
    const written = await write(() => bound.updateRelations(prepared.map(({ row }) => row)));
    firstUnwritten(
      prepared.map(({ object }) => object),
      written,
      () => new ApplyFault(DELETED_SINCE),
    );
    return;
  }
  const rows = batch.map((object) =>
    forObject(object, () => {
      const prepared = prepareDeleteRelation(loaded, object.typeKey, object.objectId);
      return { typeKey: prepared.relationTypeKey, id: prepared.relationId, search: plan(prepared.change) };
    }),
  );
  const written = new Set(await write(() => bound.deleteRelations(rows)));
  for (const row of rows) if (!written.has(row.id)) applied.alreadyGone.push(row.id);
}

/** A fault's text. A relation create the store refuses as not found names
 * an end gone since the lock-free pass, by its role; any other fault keeps
 * its text. */
function applyMessage(object: StagedObjectRecord, error: Error): string {
  if (error instanceof NotFoundError && object.kind === "relation" && object.action === "create") {
    return END_GONE;
  }
  return error.message;
}

/**
 * Step 2 of the commit: apply the staged objects on the bound store, phase
 * by phase (`PHASES`), in batches of up to `WRITE_BATCH` (`applyBatch`):
 * each object through its `prepare…`, each batch through the store's batch
 * write of its phase, its search work queued in the same transaction. A
 * staged entity delete first locks the entity and records its children; a
 * delete that finds nothing is done, and noted. No savepoints: the first
 * object that fails ends the run as its `fault` (a target gone, a
 * reference to an entity that does not exist, a value the lens no longer
 * accepts). Any other error, a lock wait past the timeout among them, is
 * thrown.
 */
export async function applyObjects(
  loaded: LoadedSchema,
  search: SearchContext,
  objects: StagedObjectRecord[],
  bound: RuntimeStore,
): Promise<Applied> {
  const applied: Applied = { applied: 0, alreadyGone: [], deletedChildren: [], identities: [], fault: null };
  const plan = (change: SearchChange): SearchWritePlan | null => planSearchWrite(search.dependencies, change);
  const readings = parentReadings(loaded.full);
  for (const [kind, action] of PHASES) {
    const phase = objects.filter((object) => object.kind === kind && object.action === action);
    for (let i = 0; i < phase.length; i += WRITE_BATCH) {
      const batch = phase.slice(i, i + WRITE_BATCH);
      try {
        await applyBatch(loaded, plan, readings, kind, action, batch, bound, applied);
      } catch (error) {
        if (!(error instanceof ObjectFault)) throw error;
        const cause = error.error;
        const faultKind = cause instanceof ApplyFault ? cause.kind : "replay";
        applied.fault = { object: error.object.objectId, kind: faultKind, message: applyMessage(error.object, cause) };
        return applied;
      }
      applied.applied += batch.length;
    }
  }
  return applied;
}

// ---------------------------------------------------------------------------
// The lock-free pass
// ---------------------------------------------------------------------------

/** Stored entities and relations are read in batches of this many ids. */
const READ_BATCH = 1000;

/** What the lock-free pass found, and what the commit's later steps take
 * from it. */
export interface LockFreePass {
  /** Every staged object, by first touch. */
  objects: StagedObjectRecord[];
  /** The faults, by object. */
  faults: Violation[];
  /** The stored targets of the staged updates and deletes: the rows step 1
   * locks. */
  targets: string[];
  /** The entities the staged objects name that are stored, as id → type. */
  stored: Map<string, string>;
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

/** The objects of a changeset by id: every judged object, and every
 * object at an end of a judged relation. */
type Known = Map<string, StagedObjectRecord>;

/** The stored rows the checks of staged objects judge them against, raw:
 * entities by id (documents as hash and length), relations by id, of any
 * type. */
interface Stored {
  entities: Map<string, Row>;
  relations: Map<string, Row>;
}

/** Whether this changeset creates the entity `id`. */
function createdHere(known: Known, id: string): boolean {
  const object = known.get(id);
  return object?.kind === "entity" && object.action === "create";
}

/** `objects` and the staged objects at the ends of their relations, in one
 * read. */
async function knownFor(changesetId: string, objects: StagedObjectRecord[], store: RuntimeStore): Promise<Known> {
  const known: Known = new Map(objects.map((object) => [object.objectId, object] as const));
  const ends = objects.flatMap((object) => (object.kind === "relation" ? [object.fromId!, object.toId!] : []));
  const unknown = [...new Set(ends)].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    for (const object of await store.changesets().objects(changesetId, unknown)) known.set(object.objectId, object);
  }
  return known;
}

/** The stored rows `objects` name, in batches: the targets of their updates
 * and deletes, and every relation end this changeset does not create. */
async function storedRows(
  loaded: LoadedSchema,
  objects: StagedObjectRecord[],
  known: Known,
  store: RuntimeStore,
): Promise<Stored> {
  const relationIds = objects
    .filter((object) => object.kind === "relation" && object.action !== "create")
    .map((object) => object.objectId);
  const relations = new Map<string, Row>();
  for (let i = 0; i < relationIds.length; i += READ_BATCH) {
    const batch = await store.getRelationsByIds(relationIds.slice(i, i + READ_BATCH));
    for (const [id, row] of Object.entries(batch)) relations.set(id, row);
  }
  const entityIds = new Set<string>();
  for (const object of objects) {
    if (object.kind === "entity") {
      if (object.action !== "create") entityIds.add(object.objectId);
      continue;
    }
    for (const end of [object.fromId!, object.toId!]) {
      if (!createdHere(known, end)) entityIds.add(end);
    }
  }
  return { entities: await storedEntities(loaded, [...entityIds], store), relations };
}

/** The stored target of a staged update or delete, when it is still
 * stored with the object's type. */
function storedTarget(object: StagedObjectRecord, stored: Stored): Row | undefined {
  if (object.kind === "entity") {
    const row = stored.entities.get(object.objectId);
    return row?._entityTypeKey === object.typeKey ? row : undefined;
  }
  const row = stored.relations.get(object.objectId);
  return row?._relationTypeKey === object.typeKey ? row : undefined;
}

/** The field errors the current lens finds in a staged object's values,
 * as applying it would meet them; a create's required value missing
 * among them. */
function fieldErrorsOf(loaded: LoadedSchema, object: StagedObjectRecord): FieldErrors {
  const values = valuesOf(object);
  const id = object.objectId;
  if (object.kind === "entity") {
    return object.action === "create"
      ? prepareCreateEntity(loaded, object.typeKey, values, null, { entityId: id, relationId: randomUUID() }).errors
      : prepareUpdateEntity(loaded, object.typeKey, id, values).errors;
  }
  return object.action === "create"
    ? prepareCreateRelation(loaded, object.typeKey, object.fromId!, object.toId!, values, id).errors
    : prepareUpdateRelation(loaded, object.typeKey, id, values).errors;
}

/** Whether `value` is a document as `recordedDocument` keeps it. */
function isRecordedDocument(value: unknown): value is Row {
  return typeof value === "object" && value !== null && typeof (value as Row).sha256 === "string";
}

/** A before as drift compares it: a document by its hash alone. */
function byHash(before: Row, document: boolean): Row {
  return document && isRecordedDocument(before.value) ? { value: before.value.sha256 } : before;
}

/** Whether the stored value of a staged update's key now differs from its
 * before: raw, absent distinct from null, a document by its hash. */
function drifted(value: StagedValueRecord, stored: Row, propertyDefs: Record<string, PropertyDef>): boolean {
  const document = propertyDefs[value.propertyKey]?.dataType === "document";
  const now = recordedBefore(stored, value.propertyKey, propertyDefs);
  return !isDeepStrictEqual(byHash(value.before!, document), byHash(now, document));
}

/** Whether a staged entity object gives its entity an identity of its
 * own: a create, or an update that stages a value of an identity
 * property. */
function stagesIdentity(loaded: LoadedSchema, object: StagedObjectRecord): boolean {
  const properties = identityPropertiesOfType(loaded, object.typeKey);
  if (object.kind !== "entity" || object.action === "delete" || properties === null) return false;
  return object.action === "create" || properties.some((property) => Object.hasOwn(valuesOf(object), property.key));
}

/** The identity faults of a staged update's values over its target's
 * current stored row `row` (an empty string, a missing value, too long),
 * as the commit meets them; none when it stages no identity property. */
function identityFaultsOver(loaded: LoadedSchema, object: StagedObjectRecord, row: Row): FieldErrors {
  const properties = identityPropertiesOfType(loaded, object.typeKey);
  if (properties === null || !stagesIdentity(loaded, object)) return {};
  return buildIdentity(properties, withoutNulls({ ...row, ...valuesOf(object) })).faults ?? {};
}

/** The defs of a staged object's type in the full schema. */
function fullDefs(loaded: LoadedSchema, object: StagedObjectRecord): Record<string, PropertyDef> {
  const types = object.kind === "entity" ? loaded.full.entityTypes : loaded.full.relationTypes;
  return types[object.typeKey]?.properties ?? {};
}

/**
 * The pass's judgement of `objects`, given the staged objects at their
 * relation ends (`known`) and the stored rows they name (`stored`). Per
 * object it finds:
 *
 * - `not_visible`: its type, or a property it sets, is no longer in the
 *   lens; nothing else is checked on that object;
 * - `replay`: a value the lens no longer accepts, or a create's required
 *   value missing, as applying it would meet them, on that property;
 * - `missing`: the stored target of an update is gone;
 * - `dangling`: an end of a staged relation is neither stored nor created
 *   in this changeset, or this changeset deletes it;
 * - `drift`: the stored value of an update's key differs from its before,
 *   on that property.
 *
 * A delete whose target is gone is no fault: the commit counts it as done.
 */
function judge(loaded: LoadedSchema, objects: StagedObjectRecord[], known: Known, stored: Stored): Violation[] {
  const lens = loaded.scoped;
  const through = `is no longer visible through lens '${lens.lensKey}'`;
  const faults: Violation[] = [];
  for (const object of objects) {
    const fault = (kind: string, message: string, property?: string): void => {
      faults.push(property === undefined ? { object: object.objectId, kind, message } : { object: object.objectId, property, kind, message });
    };
    const type = object.kind === "entity" ? lens.entityTypes[object.typeKey] : lens.relationTypes[object.typeKey];
    if (type === undefined) {
      fault("not_visible", `The type of this ${object.kind} ${through}`);
      continue;
    }
    if (object.values.some((value) => !Object.hasOwn(type.properties, value.propertyKey))) {
      fault("not_visible", `A property this ${object.kind} sets ${through}`);
      continue;
    }
    if (object.action === "delete") continue;
    const errors = fieldErrorsOf(loaded, object);
    for (const [key, message] of Object.entries(errors)) {
      fault("replay", `Instance validation failed: ${key}: ${message}`, key);
    }
    if (object.kind === "relation") {
      const ends: [string, string][] = [
        ["The source end", object.fromId!],
        ["The target end", object.toId!],
      ];
      for (const [role, id] of ends) {
        const end = known.get(id);
        if (end?.kind === "entity" && end.action === "delete") {
          fault("dangling", `${role} is deleted in this changeset`);
        } else if (object.action === "create" && !stored.entities.has(id) && !createdHere(known, id)) {
          fault("dangling", neitherStored(role));
        }
      }
    }
    if (object.action === "update") {
      const row = storedTarget(object, stored);
      if (row === undefined) {
        fault("missing", DELETED_SINCE);
        continue;
      }
      const defs = fullDefs(loaded, object);
      for (const value of object.values) {
        if (drifted(value, row, defs)) fault("drift", DRIFTED, value.propertyKey);
      }
      for (const [key, message] of Object.entries(identityFaultsOver(loaded, object, row))) {
        if (!Object.hasOwn(errors, key)) fault("replay", `Instance validation failed: ${key}: ${message}`, key);
      }
    }
  }
  return faults;
}

/** The fault of an identity another entity has after the commit. */
function duplicateIdentity(loaded: LoadedSchema, typeKey: string, identity: string): string {
  // Named only where the lens shows the whole identity.
  const shown = (loaded.scoped.entityTypes[typeKey]?.identityProperties ?? null) !== null;
  return shown
    ? `Another entity of type '${typeKey}' would have the identity '${identity}'`
    : `Another entity of type '${typeKey}' would have the same identity`;
}

/**
 * `duplicate_identity`, on each of `objects` that gives its entity an
 * identity (`givenIdentity`) another entity has after the commit: one
 * staged in this changeset that gives it the same, or a stored one that
 * keeps it (not staged, or an update that gives none). `whole` when
 * `objects` is every staged object; otherwise the identities the other
 * staged objects leave are built now (`stagedIdentities`).
 */
async function identityFaults(
  loaded: LoadedSchema,
  changesetId: string,
  objects: StagedObjectRecord[],
  whole: boolean,
  stored: Stored,
  store: RuntimeStore,
): Promise<Violation[]> {
  const byId = new Map(objects.map((object) => [object.objectId, object] as const));
  const given = new Map<string, string>();
  const byType = new Map<string, Map<string, string[]>>();
  for (const object of objects) {
    if (object.kind !== "entity" || object.action === "delete") continue;
    if (loaded.scoped.entityTypes[object.typeKey] === undefined) continue;
    const row = object.action === "update" ? storedTarget(object, stored) : null;
    if (row === undefined) continue;
    const identity = givenIdentity(loaded, object.typeKey, object.action, valuesOf(object), row);
    if (identity === null) continue;
    given.set(object.objectId, identity);
    const identities = byType.get(object.typeKey) ?? new Map<string, string[]>();
    identities.set(identity, [...(identities.get(identity) ?? []), object.objectId]);
    byType.set(object.typeKey, identities);
  }
  const faults: Violation[] = [];
  for (const [typeKey, identities] of byType) {
    const holders = await store.entitiesWithIdentities(typeKey, [...identities.keys()]);
    const staged = whole ? null : await stagedIdentities(loaded, changesetId, typeKey, store);
    for (const [identity, ids] of identities) {
      const holding = new Set(ids);
      for (const [id, after] of staged ?? []) {
        if (after === identity && !byId.has(id)) holding.add(id);
      }
      for (const holder of holders) {
        if (holder.identity !== identity) continue;
        const own = byId.get(holder.id);
        // Kept: not staged, or an update that gives it no identity of its own.
        const keeps =
          own === undefined
            ? staged === null || staged.get(holder.id) === undefined
            : own.kind !== "entity" || (own.action === "update" && !given.has(holder.id));
        if (keeps) holding.add(holder.id);
      }
      if (holding.size < 2) continue;
      for (const id of ids) {
        faults.push({ object: id, kind: "duplicate_identity", message: duplicateIdentity(loaded, typeKey, identity) });
      }
    }
  }
  return faults;
}

/** The fault of a pair another relation links after the commit. */
function duplicatePair(typeKey: string): string {
  return `Relation type '${typeKey}' is one per pair: another relation of it would link the same source and target`;
}

/**
 * `duplicate_pair`, on each of `objects` that creates a relation of a
 * one-per-pair type whose pair, source to target, another relation of the
 * type links after the commit: a stored one this changeset does not
 * delete, or another staged create.
 */
async function pairFaults(
  loaded: LoadedSchema,
  changesetId: string,
  objects: StagedObjectRecord[],
  store: RuntimeStore,
): Promise<Violation[]> {
  const pairKey = (fromId: string, toId: string): string => `${fromId} ${toId}`;
  const byType = new Map<string, StagedObjectRecord[]>();
  for (const object of objects) {
    if (object.kind !== "relation" || object.action !== "create") continue;
    if (loaded.scoped.relationTypes[object.typeKey] === undefined) continue;
    if (loaded.full.relationTypes[object.typeKey]?.onePerPair !== true) continue;
    byType.set(object.typeKey, [...(byType.get(object.typeKey) ?? []), object]);
  }
  const faults: Violation[] = [];
  for (const [typeKey, creates] of byType) {
    const pairs = [...new Map(creates.map((o) => [pairKey(o.fromId!, o.toId!), { fromId: o.fromId!, toId: o.toId! }])).values()];
    const staged = await store.changesets().relationObjectsAt(changesetId, typeKey, pairs);
    const deleted = new Set(staged.filter((o) => o.action === "delete").map((o) => o.objectId));
    const holders = new Map<string, Set<string>>();
    const hold = (key: string, id: string): void => {
      holders.set(key, (holders.get(key) ?? new Set()).add(id));
    };
    for (const relation of await store.relationsOfPairs(typeKey, pairs)) {
      if (!deleted.has(relation.id)) hold(pairKey(relation.fromId, relation.toId), relation.id);
    }
    for (const object of [...staged, ...creates]) {
      if (object.action === "create") hold(pairKey(object.fromId!, object.toId!), object.objectId);
    }
    for (const object of creates) {
      if ((holders.get(pairKey(object.fromId!, object.toId!))?.size ?? 0) > 1) {
        faults.push({ object: object.objectId, kind: "duplicate_pair", message: duplicatePair(typeKey) });
      }
    }
  }
  return faults;
}

/**
 * The lock-free pass: one paged read of the staged objects and of the
 * stored rows they name, with no lock and no transaction, judged
 * (`judge`). Submit and the commit run it; the review reads judge their own
 * objects the same way. Stored rows are read in batches, documents as hash
 * and length (`storedRows`).
 */
export async function lockFreePass(
  loaded: LoadedSchema,
  changesetId: string,
  store: RuntimeStore,
): Promise<LockFreePass> {
  const objects: StagedObjectRecord[] = [];
  for (let offset = 0; ; offset += READ_PAGE) {
    const page = await store.changesets().page(changesetId, offset, READ_PAGE);
    objects.push(...page);
    if (page.length < READ_PAGE) break;
  }
  const known: Known = new Map(objects.map((object) => [object.objectId, object] as const));
  const rows = await storedRows(loaded, objects, known, store);
  const stored = new Map([...rows.entities].map(([id, row]) => [id, row._entityTypeKey as string] as const));
  const targets = objects.filter((object) => object.action !== "create").map((object) => object.objectId);
  const faults = [
    ...judge(loaded, objects, known, rows),
    ...(await identityFaults(loaded, changesetId, objects, true, rows, store)),
    ...(await pairFaults(loaded, changesetId, objects, store)),
  ];
  return { objects, faults, targets, stored };
}

// ---------------------------------------------------------------------------
// The review read
// ---------------------------------------------------------------------------

/** A before as the review shows it: null for a key the target lacked, a
 * document as the read stub with the length it was recorded with. */
function beforeView(before: Row, property: PropertyDef): unknown {
  const value = Object.hasOwn(before, "value") ? before.value : null;
  if (property.dataType !== "document" || !isRecordedDocument(value)) return value;
  return { document: true, length: typeof value.length === "number" ? value.length : null };
}

/** A stored target's value of `key` as the review shows it as `current`:
 * null for a key it lacks, a document as the read stub, its length from
 * the hash and length the store read it as. */
function currentView(stored: Row, key: string, property: PropertyDef): unknown {
  const value = stored[key] ?? null;
  if (property.dataType === "document" && isRecordedDocument(value)) return { document: true, length: value.length };
  return value;
}

/** A staged value as the review shows it: a document as the read stub. */
function afterView(value: unknown, property: PropertyDef): unknown {
  if (property.dataType !== "document" || typeof value !== "string") return value;
  return { document: true, length: cpLength(value) };
}

/** The identity a staged entity create or update sets or changes, as
 * the review shows it; null when it gives none, or none different, or
 * the lens does not show the type's whole identity. */
function identityView(
  loaded: LoadedSchema,
  object: StagedObjectRecord,
  stored: Row | null | undefined,
): StagedObjectView["identity"] | null {
  if ((loaded.scoped.entityTypes[object.typeKey]?.identityProperties ?? null) === null) return null;
  if (stored === undefined) return null;
  const after = givenIdentity(loaded, object.typeKey, object.action, valuesOf(object), stored);
  const before = typeof stored?._identity === "string" ? stored._identity : null;
  return after === null || after === before ? null : { before, after };
}

/**
 * Staged objects as the review shows them, each judged with the objects at
 * its relation ends and the stored rows it names: names resolved, its
 * values with `before`, `current` and `after`, and the markers the pass
 * finds, on a value when they concern one it shows, else on the object.
 * Every document value is a stub (`getStagedDocument` reads the staged
 * text). Through the lens: a hidden type keeps only id, kind, action,
 * first touch and markers, and hidden properties and names are not
 * returned.
 */
async function reviewOf(
  loaded: LoadedSchema,
  changesetId: string,
  objects: StagedObjectRecord[],
  store: RuntimeStore,
): Promise<StagedObjectView[]> {
  const lens = loaded.scoped;
  const known = await knownFor(changesetId, objects, store);
  const stored = await storedRows(loaded, objects, known, store);
  const faults = new Map<string, Violation[]>();
  const judged = [
    ...judge(loaded, objects, known, stored),
    ...(await identityFaults(loaded, changesetId, objects, false, stored, store)),
    ...(await pairFaults(loaded, changesetId, objects, store)),
  ];
  for (const fault of judged) {
    faults.set(fault.object!, [...(faults.get(fault.object!) ?? []), fault]);
  }
  const marker = (fault: Violation): Marker => ({ kind: fault.kind, message: fault.message });

  const nameOf = (id: string): string | null => {
    // Raw rows: the name property is a string, never a document.
    const row = stored.entities.get(id);
    const create = row === undefined && createdHere(known, id) ? known.get(id) : undefined;
    const type = row !== undefined ? (row._entityTypeKey as string) : create?.typeKey;
    const nameProperty = type === undefined ? null : (lens.entityTypes[type]?.nameProperty ?? null);
    if (nameProperty === null) return null;
    const value =
      row !== undefined ? row[nameProperty] : create!.values.find((v) => v.propertyKey === nameProperty)?.value;
    return typeof value === "string" ? value : null;
  };

  return objects.map((object) => {
    const own = faults.get(object.objectId) ?? [];
    const type = object.kind === "entity" ? lens.entityTypes[object.typeKey] : lens.relationTypes[object.typeKey];
    const shown = type === undefined ? [] : object.values.filter((value) => Object.hasOwn(type.properties, value.propertyKey));
    const keys = new Set(shown.map((value) => value.propertyKey));
    const view: StagedObjectView = {
      id: object.objectId,
      kind: object.kind,
      type: null,
      action: object.action,
      firstTouchedAt: object.firstTouchedAt,
      markers: own.filter((fault) => fault.property === undefined || !keys.has(fault.property)).map(marker),
      values: [],
    };
    if (type === undefined) return view;
    view.type = object.typeKey;
    const target = object.action === "update" ? storedTarget(object, stored) : undefined;
    view.values = shown.map((value) => {
      const property = type.properties[value.propertyKey]!;
      return {
        property: value.propertyKey,
        before: value.before === null ? null : beforeView(value.before, property),
        current: target === undefined ? null : currentView(target, value.propertyKey, property),
        after: afterView(value.value, property),
        markers: own.filter((fault) => fault.property === value.propertyKey).map(marker),
      };
    });
    if (object.kind === "entity") {
      view.name = nameOf(object.objectId);
      const identity = identityView(loaded, object, object.action === "update" ? storedTarget(object, stored) : null);
      if (identity !== null) view.identity = identity;
    } else {
      view.from = { id: object.fromId!, name: nameOf(object.fromId!) };
      view.to = { id: object.toId!, name: nameOf(object.toId!) };
    }
    return view;
  });
}

// ---------------------------------------------------------------------------
// Commit validation
// ---------------------------------------------------------------------------

/** Step 1, after the lock: every stored target `FOR UPDATE`, and drift
 * re-checked on the rows as locked, documents read as hash and length. A
 * target gone since the pass is left to step 2. */
async function driftUnderLock(loaded: LoadedSchema, pass: LockFreePass, bound: RuntimeStore): Promise<Violation[]> {
  if (pass.targets.length === 0) return [];
  const targets = await bound.lockTargets(pass.targets, documentKeysOf(loaded));
  const locked = new Map(targets.map((row) => [`${row.kind} ${row.id}`, row] as const));
  const violations: Violation[] = [];
  for (const object of pass.objects) {
    if (object.action !== "update") continue;
    const row = locked.get(`${object.kind} ${object.objectId}`);
    if (row === undefined || row.typeKey !== object.typeKey) continue;
    const defs = fullDefs(loaded, object);
    for (const value of object.values) {
      if (drifted(value, row.props, defs)) {
        violations.push({ object: object.objectId, property: value.propertyKey, kind: "drift", message: DRIFTED });
      }
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

/** One entity a staged object touches inside the anchor's hierarchy. */
interface TouchedEnd {
  id: string;
  /** Stored before the commit. */
  before: boolean;
}

/** What a staged object touches inside the anchor's hierarchy. */
interface Touch {
  objectId: string;
  ends: TouchedEnd[];
}

/** The anchor of a changeset's ruleset, read fresh in the transaction,
 * and what its staged objects touch. */
interface Coverage {
  key: string;
  anchorId: string;
  readings: Record<string, ParentEnd>;
  touches: Touch[];
  /** The objects already refused before step 2: one violation each. */
  refused: Set<string>;
}

/** The entities of the anchor's hierarchy a staged object touches: an
 * entity its entity; a relation both ends. */
function touchOf(loaded: LoadedSchema, pass: LockFreePass, types: Set<string>, object: StagedObjectRecord): Touch {
  const ends: { id: string; type: string; before: boolean }[] = [];
  const storedBefore = (id: string): boolean => pass.stored.has(id);
  if (object.kind === "entity") {
    const id = object.objectId;
    ends.push({ id, type: object.typeKey, before: object.action !== "create" && storedBefore(id) });
  } else {
    const rt = loaded.full.relationTypes[object.typeKey];
    if (rt !== undefined) {
      ends.push({ id: object.fromId!, type: rt.fromEntityTypeKey, before: storedBefore(object.fromId!) });
      ends.push({ id: object.toId!, type: rt.toEntityTypeKey, before: storedBefore(object.toId!) });
    }
  }
  return {
    objectId: object.objectId,
    ends: ends.filter((end) => types.has(end.type)).map(({ id, before }) => ({ id, before })),
  };
}

/**
 * Step 1, on a changeset started through a ruleset: the ruleset read
 * fresh, and the coverage before step 2. One violation on the changeset as
 * a whole, and coverage is not checked, when the ruleset is gone
 * (`ruleset_gone`), its anchor deleted (`anchor_deleted`) or at an entity
 * the lens hides (`anchor_hidden`). Otherwise, as the immediate writes'
 * `AnchorGuard` checks it: every touched entity of the anchor's hierarchy
 * stored now is covered (`outside_subtree`), and no staged delete takes an
 * entity any anchor points at (`deletes_anchor`).
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
      violations: [{ object: null, kind: "ruleset_gone", message: `Ruleset '${key}' no longer exists, so this changeset cannot be committed` }],
      coverage: null,
    };
  }
  const refusal = changesetAnchorRefusal(key, record, loaded);
  if (refusal !== null) return { violations: [{ object: null, ...refusal }], coverage: null };
  if (record.anchor === null) return { violations: [], coverage: null };

  const { types, readings } = hierarchyOf(record.anchor.type, loaded.full);
  const touches = pass.objects.map((object) => touchOf(loaded, pass, types, object));
  const coverage: Coverage = { key, anchorId: record.anchor.id, readings, touches, refused: new Set() };

  const before = touches.flatMap((touch) => touch.ends.filter((end) => end.before).map((end) => end.id));
  const links = await ancestry(before, readings, bound);
  const violations: Violation[] = [];
  for (const touch of touches) {
    if (touch.ends.some((end) => end.before && !reaches(links, end.id, coverage.anchorId))) {
      violations.push({
        object: touch.objectId,
        kind: "outside_subtree",
        message: `Outside the anchor subtree of ruleset '${key}'`,
      });
    }
  }
  const deletes = pass.objects.filter((object) => object.kind === "entity" && object.action === "delete");
  const anchors =
    deletes.length === 0 ? new Set() : new Set((await bound.rulesets().list()).map((ruleset) => ruleset.anchor?.id));
  for (const object of deletes) {
    if (anchors.has(object.objectId)) {
      violations.push({
        object: object.objectId,
        kind: "deletes_anchor",
        message: "It is the anchor of a ruleset, so it cannot be deleted on this connection",
      });
    }
  }
  for (const violation of violations) coverage.refused.add(violation.object!);
  return { violations, coverage };
}

/** A parent link a staged relation create creates, with the role of its
 * child. */
interface StagedLink {
  relationId: string;
  parentId: string;
  childId: string;
  childRole: string;
}

/** A relation end a staged relation create names, by its role, with the
 * type its relation type requires there. */
interface StagedEnd {
  relationId: string;
  role: Exclude<EndRole, "The parent">;
  id: string;
  type: string;
  relationType: string;
}

/** The parent links and the relation ends the staged relation creates
 * name. */
function stagedLinksAndEnds(loaded: LoadedSchema, objects: StagedObjectRecord[]): { links: StagedLink[]; ends: StagedEnd[] } {
  const links: StagedLink[] = [];
  const ends: StagedEnd[] = [];
  for (const object of objects) {
    if (object.kind !== "relation" || object.action !== "create") continue;
    const rt = loaded.full.relationTypes[object.typeKey];
    if (rt === undefined) continue;
    const relationId = object.objectId;
    const from = object.fromId!;
    const to = object.toId!;
    ends.push({ relationId, role: "The source end", id: from, type: rt.fromEntityTypeKey, relationType: rt.key });
    ends.push({ relationId, role: "The target end", id: to, type: rt.toEntityTypeKey, relationType: rt.key });
    if (rt.parent !== null) {
      const [parentId, childId, childRole] =
        rt.parent === "source" ? [from, to, "The target end"] : [to, from, "The source end"];
      links.push({ relationId, parentId, childId, childRole });
    }
  }
  return { links, ends };
}

/**
 * Step 3: the rules over the end state, in the service, on the bound
 * store's neutral reads, after step 2. Messages name no id, only roles,
 * the relation type key and the ruleset key:
 *
 * - `has_children`: a child recorded by a staged entity delete (the delete
 *   capture) is neither deleted nor re-parented;
 * - `two_parents`, `cycle`: the immediate writes' parent rules, for every
 *   parent link the changeset creates and keeps, across every parent
 *   relation of the full schema;
 * - `endpoint_type`: a created relation's end is not of the type its
 *   relation type requires;
 * - `outside_subtree`: on a changeset whose ruleset has an anchor, a
 *   touched entity of the anchor's hierarchy that exists now is outside
 *   the anchor's subtree.
 */
async function commitViolations(
  loaded: LoadedSchema,
  pass: LockFreePass,
  applied: Applied,
  coverage: Coverage | null,
  bound: RuntimeStore,
): Promise<Violation[]> {
  const readings = parentReadings(loaded.full);
  const { links, ends } = stagedLinksAndEnds(loaded, pass.objects);
  const children = applied.deletedChildren.flatMap((deleted) => deleted.children.map((child) => child.childId));
  const touched = coverage?.touches.flatMap((touch) => touch.ends.map((end) => end.id)) ?? [];
  const ids = new Set([...children, ...links.map((link) => link.childId), ...ends.map((end) => end.id), ...touched]);
  const types = await entityTypes([...ids], bound);
  const violations: Violation[] = [];

  const remaining = children.filter((id) => types.has(id));
  const parented = new Set((await bound.parentsOf(remaining, readings)).map((link) => link.childId));
  for (const deleted of applied.deletedChildren) {
    if (deleted.children.some((child) => types.has(child.childId) && !parented.has(child.childId))) {
      violations.push({ object: deleted.objectId, kind: "has_children", message: "Still has children" });
    }
  }

  // As the immediate write: an end of the wrong type is not judged by the parent rules.
  const mistyped = new Set<string>();
  for (const end of ends) {
    const type = types.get(end.id);
    if (type !== undefined && type !== end.type) {
      mistyped.add(`${end.relationId} ${end.id}`);
      violations.push({
        object: end.relationId,
        kind: "endpoint_type",
        message: endpointTypeMessage(end.role, end.relationType),
      });
    }
  }

  const kept = links.filter(
    (link) =>
      types.has(link.childId) &&
      !mistyped.has(`${link.relationId} ${link.childId}`) &&
      !mistyped.has(`${link.relationId} ${link.parentId}`),
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
      violations.push({ object: link.relationId, kind: "two_parents", message: `${link.childRole} already has a parent` });
    }
    if (reaches(walk, link.parentId, link.childId)) {
      violations.push({ object: link.relationId, kind: "cycle", message: "This parent link would close a cycle" });
    }
  }

  if (coverage !== null) {
    const after = coverage.touches.flatMap((touch) => touch.ends.map((end) => end.id)).filter((id) => types.has(id));
    const walkAfter = await ancestry(after, coverage.readings, bound);
    for (const touch of coverage.touches) {
      if (coverage.refused.has(touch.objectId)) continue;
      if (touch.ends.some((end) => types.has(end.id) && !reaches(walkAfter, end.id, coverage.anchorId))) {
        violations.push({
          object: touch.objectId,
          kind: "outside_subtree",
          message: `Would be outside the anchor subtree of ruleset '${coverage.key}' after the commit`,
        });
      }
    }
  }
  return violations;
}

/**
 * Commit validation's `duplicate_identity`: each identity a staged object
 * gave its entity that two entities hold after the phases. The identity
 * check is deferred in the commit's transaction, so the phases may hold
 * one twice; this read sees every entity committed meanwhile.
 */
async function identityViolations(loaded: LoadedSchema, applied: Applied, bound: RuntimeStore): Promise<Violation[]> {
  const byType = new Map<string, string[]>();
  for (const given of applied.identities) byType.set(given.typeKey, [...(byType.get(given.typeKey) ?? []), given.identity]);
  const held = new Set<string>();
  for (const [typeKey, identities] of byType) {
    const counts = new Map<string, number>();
    for (const holder of await bound.entitiesWithIdentities(typeKey, [...new Set(identities)])) {
      counts.set(holder.identity, (counts.get(holder.identity) ?? 0) + 1);
    }
    for (const [identity, count] of counts) if (count > 1) held.add(`${typeKey} ${identity}`);
  }
  return applied.identities
    .filter((given) => held.has(`${given.typeKey} ${given.identity}`))
    .map((given) => ({
      object: given.objectId,
      kind: "duplicate_identity",
      message: duplicateIdentity(loaded, given.typeKey, given.identity),
    }));
}

/** A check's last step before it rolls back: the deferred identity check
 * run now, where the commit's COMMIT would run it; a duplicate is
 * `duplicate_identity` on the staged objects that gave the identity. */
async function identityCheckNow(loaded: LoadedSchema, applied: Applied, bound: RuntimeStore): Promise<Violation[]> {
  try {
    await bound.setIdentityCheck("immediate");
    return [];
  } catch (error) {
    if (!(error instanceof IdentityTakenError)) throw error;
    const { entityTypeKey, identity } = error;
    const objects = applied.identities.filter((given) => given.typeKey === entityTypeKey && given.identity === identity);
    const message = duplicateIdentity(loaded, entityTypeKey, identity);
    if (objects.length === 0) return [{ object: null, kind: "duplicate_identity", message }];
    return objects.map((given) => ({ object: given.objectId, kind: "duplicate_identity", message }));
  }
}

/** The 409 of an identity an immediate write took after the commit's
 * checks: nothing was persisted. */
const IDENTITY_TAKEN_MEANWHILE = "An identity was taken meanwhile; nothing was persisted. Check and commit again";

/** A 422 with the first violations and their total, those on the whole
 * changeset first. */
function violationsError(message: string, violations: Violation[], extra: Record<string, unknown> = {}): ValidationError {
  const ordered = [...violations.filter((v) => v.object === null), ...violations.filter((v) => v.object !== null)];
  return new ValidationError(message, {
    violations: ordered.slice(0, MAX_VIOLATIONS),
    total: violations.length,
    ...extra,
  });
}

/** The 422 of a rejected commit. */
function rejection(violations: Violation[]): ValidationError {
  return violationsError("The commit was rejected; nothing was persisted", violations);
}

/**
 * Commit a changeset: everything it stages, or nothing. With
 * `expectedVersion`, a changeset changed since is a 409. Another commit on
 * the ontology or in this process, a change running on the changeset, or
 * a row held past the lock timeout are 409s too, with nothing persisted. A
 * rejection is a 422 whose `details.violations` name the objects and
 * properties; the changeset stays as it was. Committed, the changeset is
 * gone.
 */
export async function commitChangeset(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  expectedVersion: number | undefined,
  store: RuntimeStore,
): Promise<CommitAnswer> {
  return (await runCommit(lensKey, rulesetKey, changesetId, expectedVersion, false, store)).answer;
}

/**
 * Check a changeset, draft or submitted: the commit run to its end and
 * rolled back. It refuses as the commit does; a rejection is the commit's
 * 422 with the `version` checked. Nothing changes, the changeset's version
 * and last change included.
 */
export async function checkChangeset(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  store: RuntimeStore,
): Promise<CheckAnswer> {
  const { version, answer } = await runCommit(lensKey, rulesetKey, changesetId, undefined, true, store);
  return { version, ...answer };
}

/** The commit's steps; a check rolls back at the last one and never
 * touches the changeset. */
async function runCommit(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  expectedVersion: number | undefined,
  check: boolean,
  store: RuntimeStore,
): Promise<{ version: number; answer: CommitAnswer }> {
  if (runningCommits >= MAX_RUNNING_COMMITS) {
    throw new ConflictError("Too many commits are running; try again");
  }
  runningCommits += 1;
  try {
    // Every run validates against the design it loaded and commits only
    // while it is still that design; a change in between runs it again.
    return await retryOnDesignChange(store, (current) =>
      commitRun(lensKey, rulesetKey, changesetId, expectedVersion, check, store, current));
  } finally {
    runningCommits -= 1;
  }
}

/** One run of the commit's steps against the design revision `current`. */
async function commitRun(
  lensKey: string,
  rulesetKey: string | null,
  changesetId: string,
  expectedVersion: number | undefined,
  check: boolean,
  store: RuntimeStore,
  current: DesignRevision,
): Promise<{ version: number; answer: CommitAnswer }> {
  const staleVersion = (version: number): ConflictError =>
    new ConflictError(`Changeset '${changesetId}' changed since you looked: version ${version}, not ${expectedVersion}`);
  // 0a: before BEGIN, holding nothing. Nothing inside reaches the pool.
  const { loaded, search } = await loadDesign(lensKey, store, current);
  const record = await loadChangeset(loaded, rulesetKey, changesetId, store);
  if (expectedVersion !== undefined && record.version !== expectedVersion) throw staleVersion(record.version);
  try {
    // 0b: the lock-free pass; a fault rejects with no lock taken.
    const pass = await lockFreePass(loaded, record.id, store);
    if (pass.faults.length > 0) throw new CommitRejected(pass.faults);
    // The transaction first holds the design shared and checks it.
    const answer = await store.transaction(loaded.design, async (bound) => {
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
      // 2: the phases, the identity check deferred to COMMIT, so a swap
      // may hold an identity twice for a moment; 3: commit validation.
      await bound.setIdentityCheck("deferred");
      const applied = await applyObjects(loaded, search, pass.objects, bound);
      if (applied.fault !== null) throw new CommitRejected([applied.fault]);
      const violations = [
        ...(anchor?.violations ?? []),
        ...(await commitViolations(loaded, pass, applied, anchor?.coverage ?? null, bound)),
        ...(await identityViolations(loaded, applied, bound)),
      ];
      if (violations.length > 0) throw new CommitRejected(violations);
      const answer = { committed: applied.applied, alreadyGone: applied.alreadyGone };
      // A check rolls back here, its deferred identity check run first.
      if (check) {
        const taken = await identityCheckNow(loaded, applied, bound);
        if (taken.length > 0) throw new CommitRejected(taken);
        throw new CheckPassed(answer);
      }
      // 4: the staged objects go with the changeset; COMMIT on return.
      await bound.changesets().deleteCommitted(record.id);
      return answer;
    });
    return { version: record.version, answer };
  } catch (error) {
    if (error instanceof CheckPassed) return { version: record.version, answer: error.answer };
    // The deferred identity check failed at COMMIT: the changeset stays as it was.
    if (error instanceof IdentityTakenError) throw new ConflictError(IDENTITY_TAKEN_MEANWHILE);
    if (!(error instanceof CommitRejected)) throw error;
    if (check) {
      throw violationsError(`Checked version ${record.version}: the commit would be rejected`, error.violations, {
        version: record.version,
      });
    }
    await store.changesets().touch(record.id);
    throw rejection(error.violations);
  }
}
