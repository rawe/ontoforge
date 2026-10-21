/**
 * The anchor rule of a ruleset mount (`…/rulesets/:rulesetKey`): the seven
 * runtime write functions consult it on ruleset calls only. It holds the
 * anchor's hierarchy to the anchor's subtree; every other type is free and
 * is written as on the plain lens.
 *
 * - **The anchor's hierarchy**: the entity types joined by parent
 *   relations around the anchor entity's type, over the FULL schema, and
 *   the parent relation types among them. A separate tree (another
 *   component of parent relations) is free.
 * - **Covered**: the anchor entity itself, or an entity with the anchor
 *   entity among its ancestors (the walk over the hierarchy's parent
 *   relations).
 *
 * The ruleset is read fresh and the walk runs just before the write,
 * never inside its transaction; no guard value crosses the port and nothing
 * is locked, so a re-point or a move racing the call is accepted (A9).
 * Without an anchor, there is no guard; with the anchor deleted, or at an
 * entity the lens hides, every write is refused with a 409. Refusals are
 * 422 field errors that name only what the caller sent and the ruleset key.
 * Staging through the URL takes `checkStaging` instead: no coverage (R10).
 */

import { ConflictError, NotFoundError, ValidationError } from "../core/exceptions.js";
import type { AnchorEntity, RulesetRecord, RuntimeStore } from "../core/ports.js";
import type { ParentEnd } from "../core/schemas.js";
import type { AnchorState } from "./rulesets.js";
import type { EntityTypeDef, LoadedSchema, RelationTypeDef, SchemaCacheValue } from "./schemaCache.js";

type Row = Record<string, unknown>;

/** The state of a ruleset's anchor against the FULL schema's entity
 * types: null without an anchor; an entity no longer stored, or of a type
 * no longer in the schema, is `deleted`. */
export function anchorState(record: RulesetRecord, entityTypes: Record<string, EntityTypeDef>): AnchorState | null {
  if (record.anchor === null) return null;
  return record.anchorFound && Object.hasOwn(entityTypes, record.anchor.type) ? "found" : "deleted";
}

/** The child and parent ends of a parent relation type. */
function ends(rt: RelationTypeDef, parent: ParentEnd): { child: string; parent: string } {
  return parent === "source"
    ? { child: rt.toEntityTypeKey, parent: rt.fromEntityTypeKey }
    : { child: rt.fromEntityTypeKey, parent: rt.toEntityTypeKey };
}

/** The hierarchy around `entityType`: its entity types, and its parent
 * relations as relation type key → parent end. */
export function hierarchyOf(entityType: string, full: SchemaCacheValue): { types: Set<string>; readings: Record<string, ParentEnd> } {
  const types = new Set([entityType]);
  const readings: Record<string, ParentEnd> = {};
  const parentRelations = Object.values(full.relationTypes).filter((rt) => rt.parent !== null);
  let grown = true;
  while (grown) {
    grown = false;
    for (const rt of parentRelations) {
      if (rt.key in readings) continue;
      if (types.has(rt.fromEntityTypeKey) || types.has(rt.toEntityTypeKey)) {
        readings[rt.key] = rt.parent!;
        types.add(rt.fromEntityTypeKey);
        types.add(rt.toEntityTypeKey);
        grown = true;
      }
    }
  }
  return { types, readings };
}

/** Why every write through a ruleset is refused: its anchor deleted, or
 * at an entity the lens hides; null without an anchor or when it is found
 * and shown. */
function anchorFault(record: RulesetRecord, loaded: LoadedSchema): "deleted" | "hidden" | null {
  if (record.anchor === null) return null;
  if (anchorState(record, loaded.full.entityTypes) === "deleted") return "deleted";
  return Object.hasOwn(loaded.scoped.entityTypes, record.anchor.type) ? null : "hidden";
}

/** The refusal of an immediate write through a ruleset (`anchorFault`). The
 * texts name the ruleset key and the lens key only. */
export function anchorRefusal(rulesetKey: string, record: RulesetRecord, loaded: LoadedSchema): string | null {
  switch (anchorFault(record, loaded)) {
    case "deleted":
      return `Anchor '${rulesetKey}' is dangling: its entity no longer exists, so every write is refused until a person re-anchors it`;
    case "hidden":
      return `Anchor '${rulesetKey}' points at an entity that lens '${loaded.scoped.lensKey}' does not show, so every write is refused`;
    default:
      return null;
  }
}

/** The same refusal for a changeset's staging, submit and commit: what is
 * wrong, with the ruleset key and the lens key, and no fix. */
export function changesetAnchorRefusal(rulesetKey: string, record: RulesetRecord, loaded: LoadedSchema): string | null {
  switch (anchorFault(record, loaded)) {
    case "deleted":
      return `Anchor '${rulesetKey}' is dangling`;
    case "hidden":
      return `Anchor '${rulesetKey}' points at an entity that lens '${loaded.scoped.lensKey}' does not show`;
    default:
      return null;
  }
}

/** The ruleset of a ruleset call, read fresh; an unknown key is not
 * found. */
async function readRecord(rulesetKey: string, store: RuntimeStore): Promise<RulesetRecord> {
  const record = await store.rulesets().get(rulesetKey);
  if (record === null) throw new NotFoundError(`Anchor '${rulesetKey}' not found`);
  return record;
}

/** The refusal of an entity delete on an anchored connection while any
 * anchor points at the entity. */
function anchoredDeleteMessage(entityId: string): string {
  return `Entity '${entityId}' is anchored and cannot be deleted on an anchored connection`;
}

function refuse(field: string, message: string): ValidationError {
  return new ValidationError("Instance validation failed", { fields: { [field]: message } });
}

export class AnchorGuard {
  private constructor(
    private readonly rulesetKey: string,
    private readonly anchor: AnchorEntity,
    private readonly types: Set<string>,
    private readonly readings: Record<string, ParentEnd>,
    private readonly loaded: LoadedSchema,
    private readonly store: RuntimeStore,
  ) {}

  /**
   * The guard of one immediate write through a ruleset, from the ruleset
   * read fresh now; null on the plain lens (`rulesetKey` null) and without
   * an anchor. An unknown key is not found; the anchor deleted, or at an
   * entity the lens hides, is a 409.
   */
  static async open(rulesetKey: string | null, loaded: LoadedSchema, store: RuntimeStore): Promise<AnchorGuard | null> {
    if (rulesetKey === null) return null;
    const record = await readRecord(rulesetKey, store);
    const refusal = anchorRefusal(rulesetKey, record, loaded);
    if (refusal !== null) throw new ConflictError(refusal);
    if (record.anchor === null) return null;
    const { types, readings } = hierarchyOf(record.anchor.type, loaded.full);
    return new AnchorGuard(rulesetKey, record.anchor, types, readings, loaded, store);
  }

  /**
   * Staging through a ruleset URL (R10): an unknown key is not found;
   * the anchor deleted, or at an entity the lens hides, is a 409, as for an
   * immediate write but with the changeset's text. Coverage is a commit
   * rule. Nothing on the plain lens.
   */
  static async checkStaging(rulesetKey: string | null, loaded: LoadedSchema, store: RuntimeStore): Promise<void> {
    if (rulesetKey === null) return;
    const refusal = changesetAnchorRefusal(rulesetKey, await readRecord(rulesetKey, store), loaded);
    if (refusal !== null) throw new ConflictError(refusal);
  }

  private inHierarchy(entityType: string): boolean {
    return this.types.has(entityType);
  }

  private isHierarchyRelation(rt: RelationTypeDef): boolean {
    return rt.key in this.readings;
  }

  private async covered(entityId: string): Promise<boolean> {
    if (entityId === this.anchor.id) return true;
    return (await this.store.getAncestors(entityId, this.readings)).some((a) => a.id === this.anchor.id);
  }

  /** Whether an end of a relation may be written: free, or covered. */
  private async endAllowed(entityType: string, entityId: string): Promise<boolean> {
    return !this.inHierarchy(entityType) || (await this.covered(entityId));
  }

  private notUnder(id: string, what: "Entity" | "Relation" = "Entity"): string {
    return `${what} '${id}' is not under anchor '${this.rulesetKey}'`;
  }

  /**
   * An entity create: a hierarchy type must be placed under a covered
   * parent in the same call. Faults join `errors`, after the validation of
   * the parent relation (`parentRelation.type` and `.parentId` already
   * checked there: any parent relation into a hierarchy type belongs to
   * the hierarchy). A free type is created as on the plain lens.
   */
  async checkCreate(
    entityTypeKey: string,
    parentRelation: { parentId: string } | null,
    errors: Record<string, string>,
  ): Promise<void> {
    if (!this.inHierarchy(entityTypeKey)) return;
    // Same text whether the type has no parent relation or only hidden ones.
    const placeable = Object.values(this.loaded.full.relationTypes).some(
      (rt) =>
        rt.parent !== null &&
        ends(rt, rt.parent).child === entityTypeKey &&
        Object.hasOwn(this.loaded.scoped.relationTypes, rt.key),
    );
    if (!placeable) {
      errors.entityTypeKey = `Entity type '${entityTypeKey}' cannot be placed under anchor '${this.rulesetKey}'`;
      return;
    }
    if (parentRelation === null) {
      errors.parentRelation = `Required: name the parent under anchor '${this.rulesetKey}' for an entity of type '${entityTypeKey}'`;
      return;
    }
    if ("parentRelation.type" in errors || "parentRelation.parentId" in errors) return;
    if (!(await this.covered(parentRelation.parentId))) {
      errors["parentRelation.parentId"] = this.notUnder(parentRelation.parentId);
    }
  }

  /** The `entityId` fault of an update, a document edit or a delete: a
   * hierarchy entity outside the subtree; null when allowed. A missing
   * entity stays not found. */
  async entityError(entityTypeKey: string, entityId: string): Promise<string | null> {
    if (await this.endAllowed(entityTypeKey, entityId)) return null;
    if ((await this.store.getEntity(entityTypeKey, entityId)) === null) {
      throw new NotFoundError(`Entity '${entityId}' not found`);
    }
    return this.notUnder(entityId);
  }

  /** An entity update or document edit: throws the `entityId` refusal. */
  async checkEntity(entityTypeKey: string, entityId: string): Promise<void> {
    const error = await this.entityError(entityTypeKey, entityId);
    if (error !== null) throw refuse("entityId", error);
  }

  /** An entity delete, first refusal wins: outside the subtree, then
   * frozen because any anchor points at it. "Has children" follows in the
   * service. */
  async checkDelete(entityTypeKey: string, entityId: string): Promise<void> {
    await this.checkEntity(entityTypeKey, entityId);
    const rulesets = await this.store.rulesets().list();
    if (rulesets.some((r) => r.anchor?.id === entityId && r.anchor.type === entityTypeKey)) {
      throw refuse("entityId", anchoredDeleteMessage(entityId));
    }
  }

  /**
   * A relation create. A parent relation of the hierarchy is never written
   * standalone (`relationTypeKey`): only the create with a parent relation
   * writes one. Any other relation needs each end free or covered; an end
   * that already carries an endpoint fault is not checked.
   */
  async checkRelationCreate(
    rt: RelationTypeDef,
    fromEntityId: string,
    toEntityId: string,
    errors: Record<string, string>,
  ): Promise<void> {
    if (this.isHierarchyRelation(rt)) {
      errors.relationTypeKey =
        `Relation type '${rt.key}' places entities under anchor '${this.rulesetKey}', ` +
        "so create the child together with its parent relation instead";
      return;
    }
    for (const [field, id, type] of [
      ["fromEntityId", fromEntityId, rt.fromEntityTypeKey],
      ["toEntityId", toEntityId, rt.toEntityTypeKey],
    ] as const) {
      if (!(field in errors) && !(await this.endAllowed(type, id))) {
        errors[field] = this.notUnder(id);
      }
    }
  }

  /**
   * The `relationId` fault of a relation update or delete; null when
   * allowed. A parent relation of the hierarchy needs its child end
   * covered; then it may be updated, and is never deleted (half a move).
   * Any other relation needs each end free or covered. A missing relation
   * stays not found.
   */
  async relationError(rt: RelationTypeDef, relationId: string, op: "update" | "delete"): Promise<string | null> {
    const relation: Row | null = await this.store.getRelation(rt.key, relationId);
    if (relation === null) throw new NotFoundError(`Relation '${relationId}' not found`);
    const from = relation.fromEntityId as string;
    const to = relation.toEntityId as string;
    if (this.isHierarchyRelation(rt)) {
      const child = rt.parent === "source" ? to : from;
      if (!(await this.covered(child))) return this.notUnder(relationId, "Relation");
      return op === "delete"
        ? `Relation '${relationId}' places an entity under anchor '${this.rulesetKey}' and cannot be deleted on an anchored connection`
        : null;
    }
    const allowed =
      (await this.endAllowed(rt.fromEntityTypeKey, from)) && (await this.endAllowed(rt.toEntityTypeKey, to));
    return allowed ? null : this.notUnder(relationId, "Relation");
  }

  /** A relation delete: throws the `relationId` refusal. */
  async checkRelationDelete(rt: RelationTypeDef, relationId: string): Promise<void> {
    const error = await this.relationError(rt, relationId, "delete");
    if (error !== null) throw refuse("relationId", error);
  }
}
