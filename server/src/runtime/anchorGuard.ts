/**
 * The write guard of an anchored mount (`…/anchors/:anchorKey`): the seven
 * runtime write functions consult it on anchored calls only. It holds the
 * anchor's hierarchy to the anchored subtree; every other type is free and
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
 * The anchor record is read fresh and the walk runs just before the write,
 * never inside its transaction; no guard value crosses the port and nothing
 * is locked, so a re-point or a move racing the call is accepted (A9).
 * Unanchored, there is no guard; dangling, or anchored at an entity the
 * lens hides, every write is refused with a 409. Refusals are 422 field
 * errors that name only what the caller sent and the anchor key.
 *
 * A staged-only anchor (V9 a) refuses every immediate write with a 409.
 * The flag is read before the anchor's state is judged (V43), so it holds
 * on an unanchored key too. Staging through the URL takes `checkStaging`
 * instead: no flag, no coverage (R10).
 */

import { ConflictError, NotFoundError, ValidationError } from "../core/exceptions.js";
import type { AnchorEntity, AnchorRecord, RuntimeStore } from "../core/ports.js";
import type { ParentEnd } from "../core/schemas.js";
import type { AnchorState } from "./anchors.js";
import type { EntityTypeDef, LoadedSchema, RelationTypeDef, SchemaCacheValue } from "./schemaCache.js";

type Row = Record<string, unknown>;

/** The state of an anchor record against the FULL schema's entity types:
 * no entity is `unanchored`; an entity no longer stored, or of a type no
 * longer in the schema, is `dangling`. */
export function anchorState(record: AnchorRecord, entityTypes: Record<string, EntityTypeDef>): AnchorState {
  if (record.entity === null) return "unanchored";
  return record.entityFound && Object.hasOwn(entityTypes, record.entity.type) ? "anchored" : "dangling";
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

/**
 * Why every write through an anchor is refused: dangling, or anchored at an
 * entity the lens hides; null when unanchored or anchored and shown. The
 * texts name the anchor key and the lens key only.
 */
export function anchorRefusal(anchorKey: string, record: AnchorRecord, loaded: LoadedSchema): string | null {
  const state = anchorState(record, loaded.full.entityTypes);
  if (state === "unanchored") return null;
  if (state === "dangling" || record.entity === null) {
    return `Anchor '${anchorKey}' is dangling: its entity no longer exists, so every write is refused until a person re-anchors it`;
  }
  if (!Object.hasOwn(loaded.scoped.entityTypes, record.entity.type)) {
    return `Anchor '${anchorKey}' points at an entity that lens '${loaded.scoped.lensKey}' does not show, so every write is refused`;
  }
  return null;
}

/** The refusal of an immediate write through a staged-only anchor. */
export function stagedOnlyMessage(anchorKey: string): string {
  return `Anchor '${anchorKey}' is staged-only: this connection only stages; pass a changeset`;
}

/** The anchor record of an anchored call, read fresh; an unknown key is
 * not found. */
async function readRecord(anchorKey: string, store: RuntimeStore): Promise<AnchorRecord> {
  const record = await store.anchors().getAnchor(anchorKey);
  if (record === null) throw new NotFoundError(`Anchor '${anchorKey}' not found`);
  return record;
}

/** The refusal of an entity delete on an anchored connection while any
 * anchor points at the entity. */
export function anchoredDeleteMessage(entityId: string): string {
  return `Entity '${entityId}' is anchored and cannot be deleted on an anchored connection`;
}

function refuse(field: string, message: string): ValidationError {
  return new ValidationError("Instance validation failed", { fields: { [field]: message } });
}

export class AnchorGuard {
  private constructor(
    private readonly anchorKey: string,
    private readonly anchor: AnchorEntity,
    private readonly types: Set<string>,
    private readonly readings: Record<string, ParentEnd>,
    private readonly loaded: LoadedSchema,
    private readonly store: RuntimeStore,
  ) {}

  /**
   * The guard of one anchored immediate write, from the anchor read fresh
   * now; null on the plain lens (`anchorKey` null) and when unanchored. An
   * unknown key is not found; staged-only, whatever the state, is a 409;
   * then dangling, or an anchored entity the lens hides, is a 409.
   */
  static async open(anchorKey: string | null, loaded: LoadedSchema, store: RuntimeStore): Promise<AnchorGuard | null> {
    if (anchorKey === null) return null;
    const record = await readRecord(anchorKey, store);
    if (record.stagedOnly) throw new ConflictError(stagedOnlyMessage(anchorKey));
    const refusal = anchorRefusal(anchorKey, record, loaded);
    if (refusal !== null) throw new ConflictError(refusal);
    if (record.entity === null) return null;
    const { types, readings } = hierarchyOf(record.entity.type, loaded.full);
    return new AnchorGuard(anchorKey, record.entity, types, readings, loaded, store);
  }

  /**
   * Staging through an anchored URL (R10): an unknown key is not found;
   * dangling, or an anchored entity the lens hides, is a 409, as for an
   * immediate write. Staged-only does not apply, and coverage is a commit
   * rule. Nothing on the plain lens.
   */
  static async checkStaging(anchorKey: string | null, loaded: LoadedSchema, store: RuntimeStore): Promise<void> {
    if (anchorKey === null) return;
    const refusal = anchorRefusal(anchorKey, await readRecord(anchorKey, store), loaded);
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
    return `${what} '${id}' is not under anchor '${this.anchorKey}'`;
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
      errors.entityTypeKey = `Entity type '${entityTypeKey}' cannot be placed under anchor '${this.anchorKey}'`;
      return;
    }
    if (parentRelation === null) {
      errors.parentRelation = `Required: name the parent under anchor '${this.anchorKey}' for an entity of type '${entityTypeKey}'`;
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
    const anchors = await this.store.anchors().listAnchors();
    if (anchors.some((a) => a.entity?.id === entityId && a.entity.type === entityTypeKey)) {
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
        `Relation type '${rt.key}' places entities under anchor '${this.anchorKey}', ` +
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
        ? `Relation '${relationId}' places an entity under anchor '${this.anchorKey}' and cannot be deleted on an anchored connection`
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
