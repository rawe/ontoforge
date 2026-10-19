/**
 * The pure half of the six stageable runtime writes: one `prepare…` per
 * operation turns a payload into the exact arguments of the store call and
 * the search change it causes. The immediate service functions
 * (`service.ts`) use them today; staging and the commit's replay use the
 * same ones, so the write composition exists once.
 *
 * A `prepare…` reads no storage. It takes the loaded schema, the type key,
 * the target id, the body and the ids the caller minted, and holds:
 *
 * - property validation against the SCOPED definitions, with every fault
 *   collected under its field key;
 * - defaults from the FULL schema for properties not supplied, including
 *   properties the lens hides; a default that fails coercion is skipped;
 * - the document-length bookkeeping;
 * - for an update, the set and remove split and the no-op short-circuit.
 *
 * What reads storage stays with the caller: endpoint existence and types,
 * the parent rules, the anchor guard, the search plan and the store call.
 * The caller appends the faults its reads find to `errors`, in that order,
 * and refuses the write when any is present; the write is used only then.
 */

import { CoercionError, coerceValue } from "../core/dataTypes.js";
import { NotFoundError } from "../core/exceptions.js";
import type { ParentEnd, PropertyDef } from "../core/schemas.js";
import type { SearchChange } from "../core/searchDependencies.js";
import { cpLength } from "./codePoints.js";
import { docLengthKey, documentPropertyKeys } from "./readHelpers.js";
import type { EntityTypeDef, LoadedSchema, RelationTypeDef } from "./schemaCache.js";

type Row = Record<string, unknown>;

/** Field errors of a write, keyed as the 422's `details.fields`. */
export type FieldErrors = Record<string, string>;

/** A prepared write: the payload's own faults, in report order, and the
 * write itself, meaningful only when no fault is present at all. */
export interface Prepared<W> {
  errors: FieldErrors;
  write: W;
}

/** The arguments of an entity create, as the store takes them. */
export interface EntityCreateArgs {
  entityTypeKey: string;
  entityId: string;
  properties: Row;
  propertyDefs: Record<string, PropertyDef>;
  change: SearchChange;
}

/** The arguments of a relation create, as the store takes them. */
export interface RelationCreateArgs {
  relationTypeKey: string;
  relationId: string;
  fromEntityId: string;
  toEntityId: string;
  properties: Row;
  propertyDefs: Record<string, PropertyDef>;
  change: SearchChange;
}

/** The parent relation a create names for its new entity:
 * `parentRelation` on REST, `parent_relation` on MCP. */
export interface ParentRelationInput {
  /** The parent relation type's key. */
  type: string;
  /** The parent's id; its type follows from the relation type's parent end. */
  parentId: string;
  /** The relation's own properties. */
  properties?: Row | undefined;
}

/** An entity create: the entity, and the relation naming its parent. */
export interface EntityCreateWrite {
  entity: EntityCreateArgs;
  /** Null without a parent relation, or when its fault leaves nothing to
   * write. `parentType` is the type the parent must have: the caller checks
   * the parent end against storage as a relation create checks its ends. */
  parent: { relation: RelationCreateArgs; parentId: string; parentType: string } | null;
}

/** The arguments of a property update, as the store takes them. */
export interface UpdateArgs {
  setProperties: Row;
  removeProperties: string[];
  propertyDefs: Record<string, PropertyDef>;
  change: SearchChange;
}

export interface EntityUpdateArgs extends UpdateArgs {
  entityTypeKey: string;
  entityId: string;
}

export interface RelationUpdateArgs extends UpdateArgs {
  relationTypeKey: string;
  relationId: string;
}

export interface EntityDeleteArgs {
  entityTypeKey: string;
  entityId: string;
  change: SearchChange;
}

export interface RelationDeleteArgs {
  relationTypeKey: string;
  relationId: string;
  change: SearchChange;
}

/** The entity type through the lens; an unknown or hidden one is not found. */
export function scopedEntityType(loaded: LoadedSchema, entityTypeKey: string): EntityTypeDef {
  const scopedEt = loaded.scoped.entityTypes[entityTypeKey];
  if (scopedEt === undefined) {
    throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  }
  return scopedEt;
}

/** The relation type through the lens; an unknown or hidden one is not found. */
export function scopedRelationType(loaded: LoadedSchema, relationTypeKey: string): RelationTypeDef {
  const scopedRt = loaded.scoped.relationTypes[relationTypeKey];
  if (scopedRt === undefined) {
    throw new NotFoundError(`Relation type '${relationTypeKey}' not found`);
  }
  return scopedRt;
}

// ---------------------------------------------------------------------------
// Property validation
// ---------------------------------------------------------------------------

/**
 * Validate and coerce a property payload against (scoped) definitions.
 * Returns `[coerced, errors]`; in partial mode a coerced `null` means
 * "remove this property".
 */
export function validateProperties(
  properties: Row,
  propertyDefs: Record<string, PropertyDef>,
  typeKey: string,
  partial = false,
): [Row, Record<string, string>] {
  const coerced: Row = {};
  const errors: Record<string, string> = {};

  for (const key of Object.keys(properties)) {
    if (!(key in propertyDefs)) {
      errors[key] = `Unknown property: not defined in type '${typeKey}'`;
    }
  }

  for (const [propKey, propDef] of Object.entries(propertyDefs)) {
    if (propKey in properties) {
      const value = properties[propKey];
      if (value === null || value === undefined) {
        if (partial) {
          if (propDef.required) {
            errors[propKey] = "Cannot set required property to null";
          } else {
            coerced[propKey] = null;
          }
        } else {
          if (propDef.required && propDef.defaultValue === null) {
            errors[propKey] = "Required property missing";
          } else if (propDef.defaultValue !== null) {
            try {
              coerced[propKey] = coerceValue(propDef.defaultValue, propDef.dataType, propKey);
            } catch (error) {
              if (!(error instanceof CoercionError)) throw error;
              errors[propKey] = error.message;
            }
          }
        }
      } else {
        try {
          coerced[propKey] = coerceValue(value, propDef.dataType, propKey);
        } catch (error) {
          if (!(error instanceof CoercionError)) throw error;
          errors[propKey] = error.message;
        }
      }
    } else if (!partial) {
      if (propDef.required) {
        if (propDef.defaultValue !== null) {
          try {
            coerced[propKey] = coerceValue(propDef.defaultValue, propDef.dataType, propKey);
          } catch (error) {
            if (!(error instanceof CoercionError)) throw error;
            errors[propKey] = error.message;
          }
        } else {
          errors[propKey] = "Required property missing";
        }
      }
    }
  }

  return [coerced, errors];
}

/** Defaults from the FULL definitions for properties not supplied. A
 * default that fails coercion is skipped silently: validation has already
 * passed, so the property is left out (the second documented bad-default
 * failure mode). */
function applyDefaults(coerced: Row, fullDefs: Record<string, PropertyDef>): void {
  for (const [propKey, propDef] of Object.entries(fullDefs)) {
    if (!(propKey in coerced) && propDef.defaultValue !== null) {
      try {
        coerced[propKey] = coerceValue(propDef.defaultValue, propDef.dataType, propKey);
      } catch (error) {
        if (!(error instanceof CoercionError)) throw error;
        // Skip defaults that fail coercion.
      }
    }
  }
}

/** The set and remove split of a partial payload: a coerced `null`
 * removes the property. */
function splitPatch(coerced: Row): { setProperties: Row; removeProperties: string[] } {
  const setProperties: Row = {};
  const removeProperties: string[] = [];
  for (const [k, v] of Object.entries(coerced)) {
    if (v === null) {
      removeProperties.push(k);
    } else {
      setProperties[k] = v;
    }
  }
  return { setProperties, removeProperties };
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/**
 * Validate the parent relation of a create exactly like a relation create,
 * collecting its faults into `errors` under `parentRelation.*`, beside the
 * entity's own field errors:
 *
 * - `parentRelation.type`: the relation type is visible through the lens,
 *   is a parent relation, and its child end is the new entity's type;
 * - `parentRelation.properties.<key>`: the relation's properties, against
 *   the SCOPED definitions, with defaults from the FULL schema.
 *
 * The parent end itself (`parentRelation.parentId`: it exists and has the
 * parent end's type) reads storage, so the caller checks it. The parent
 * rules need no check: the child is brand new, so it has no parent yet and
 * no descendants that could close a cycle.
 *
 * Returns null when a fault leaves nothing to write.
 */
function prepareParentRelation(
  loaded: LoadedSchema,
  entityTypeKey: string,
  entityId: string,
  input: ParentRelationInput,
  relationId: string,
  errors: FieldErrors,
): EntityCreateWrite["parent"] {
  const scopedRt = loaded.scoped.relationTypes[input.type];
  if (scopedRt === undefined) {
    errors["parentRelation.type"] = `Relation type '${input.type}' not found`;
    return null;
  }

  const [coerced, propertyErrors] = validateProperties(input.properties ?? {}, scopedRt.properties, input.type);
  for (const [key, message] of Object.entries(propertyErrors)) {
    errors[`parentRelation.properties.${key}`] = message;
  }
  const fullRt = loaded.full.relationTypes[input.type] ?? scopedRt;
  applyDefaults(coerced, fullRt.properties);

  const parentEnd: ParentEnd | null = fullRt.parent;
  if (parentEnd === null) {
    errors["parentRelation.type"] = `Relation type '${input.type}' is not a parent relation`;
    return null;
  }
  const [childType, parentType] =
    parentEnd === "source"
      ? [fullRt.toEntityTypeKey, fullRt.fromEntityTypeKey]
      : [fullRt.fromEntityTypeKey, fullRt.toEntityTypeKey];
  if (childType !== entityTypeKey) {
    errors["parentRelation.type"] =
      `Relation type '${input.type}' places '${childType}' under a parent, not '${entityTypeKey}'`;
    return null;
  }

  const [fromEntityId, toEntityId] =
    parentEnd === "source" ? [input.parentId, entityId] : [entityId, input.parentId];
  return {
    relation: {
      relationTypeKey: input.type,
      relationId,
      fromEntityId,
      toEntityId,
      properties: coerced,
      propertyDefs: fullRt.properties,
      change: { kind: "relationCreated", relationType: input.type, relationId },
    },
    parentId: input.parentId,
    parentType,
  };
}

/**
 * An entity create: validate against the SCOPED properties, apply defaults
 * from the FULL schema, and store the character count of every document
 * value beside it. With `parentRelation`, the relation naming the new
 * entity's parent is prepared too, oriented by its parent end; its faults
 * join the entity's (`prepareParentRelation`).
 */
export function prepareCreateEntity(
  loaded: LoadedSchema,
  entityTypeKey: string,
  body: Row,
  parentRelation: ParentRelationInput | null,
  ids: { entityId: string; relationId: string },
): Prepared<EntityCreateWrite> {
  const scopedEt = scopedEntityType(loaded, entityTypeKey);

  const [coerced, errors] = validateProperties(body, scopedEt.properties, entityTypeKey);
  const parent =
    parentRelation === null
      ? null
      : prepareParentRelation(loaded, entityTypeKey, ids.entityId, parentRelation, ids.relationId, errors);

  const fullEt = loaded.full.entityTypes[entityTypeKey];
  if (fullEt !== undefined) {
    applyDefaults(coerced, fullEt.properties);
  }

  // Document properties: store character counts alongside the values.
  const docKeys = fullEt !== undefined ? documentPropertyKeys(fullEt.properties) : new Set<string>();
  const docValues: Row = {};
  for (const [k, v] of Object.entries(coerced)) {
    if (docKeys.has(k)) {
      docValues[k] = v;
    }
  }
  for (const [k, v] of Object.entries(docValues)) {
    if (v !== null && v !== undefined) {
      coerced[docLengthKey(k)] = cpLength(v as string);
    }
  }

  return {
    errors,
    write: {
      entity: {
        entityTypeKey,
        entityId: ids.entityId,
        properties: coerced,
        propertyDefs: fullEt?.properties ?? {},
        change: { kind: "entityCreated", entityType: entityTypeKey, entityId: ids.entityId },
      },
      parent,
    },
  };
}

/**
 * A partial entity update: validate against the SCOPED properties, NO
 * default re-application. Null removes an optional property (and is a
 * fault on a required one). A changed document value updates its stored
 * length; a removed one removes it. The write is null when the payload
 * changes nothing.
 */
export function prepareUpdateEntity(
  loaded: LoadedSchema,
  entityTypeKey: string,
  entityId: string,
  body: Row,
): Prepared<EntityUpdateArgs | null> {
  const scopedEt = scopedEntityType(loaded, entityTypeKey);

  const [coerced, errors] = validateProperties(body, scopedEt.properties, entityTypeKey, true);
  const { setProperties, removeProperties } = splitPatch(coerced);
  if (Object.keys(setProperties).length === 0 && removeProperties.length === 0) {
    return { errors, write: null };
  }

  const fullEt = loaded.full.entityTypes[entityTypeKey];

  // Document properties: maintain stored lengths for changed values.
  const docKeys = fullEt !== undefined ? documentPropertyKeys(fullEt.properties) : new Set<string>();
  for (const k of docKeys) {
    if (k in coerced) {
      const v = coerced[k];
      if (typeof v === "string") {
        setProperties[docLengthKey(k)] = cpLength(v);
      } else {
        removeProperties.push(docLengthKey(k));
      }
    }
  }

  return {
    errors,
    write: {
      entityTypeKey,
      entityId,
      setProperties,
      removeProperties,
      propertyDefs: fullEt?.properties ?? {},
      change: { kind: "entityUpdated", entityType: entityTypeKey, entityId, changedKeys: Object.keys(coerced) },
    },
  };
}

/** An entity delete. The rules that decide whether it may go (it exists,
 * it has no children) read storage, so the caller checks them. */
export function prepareDeleteEntity(loaded: LoadedSchema, entityTypeKey: string, entityId: string): EntityDeleteArgs {
  scopedEntityType(loaded, entityTypeKey);
  return { entityTypeKey, entityId, change: { kind: "entityDeleted", entityType: entityTypeKey, entityId } };
}

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

/**
 * A relation create: validate the properties against the SCOPED
 * definitions and apply defaults from the FULL schema. The ends (they
 * exist, their types match, the parent rules) read storage, so the caller
 * checks them.
 */
export function prepareCreateRelation(
  loaded: LoadedSchema,
  relationTypeKey: string,
  fromEntityId: string,
  toEntityId: string,
  body: Row,
  relationId: string,
): Prepared<RelationCreateArgs> {
  const scopedRt = scopedRelationType(loaded, relationTypeKey);

  const [coerced, errors] = validateProperties(body, scopedRt.properties, relationTypeKey);
  const fullRt = loaded.full.relationTypes[relationTypeKey];
  if (fullRt !== undefined) {
    applyDefaults(coerced, fullRt.properties);
  }

  return {
    errors,
    write: {
      relationTypeKey,
      relationId,
      fromEntityId,
      toEntityId,
      properties: coerced,
      propertyDefs: (fullRt ?? scopedRt).properties,
      change: { kind: "relationCreated", relationType: relationTypeKey, relationId },
    },
  };
}

/**
 * A partial relation update. ENDPOINTS ARE IMMUTABLE: payload keys
 * `fromEntityId` / `toEntityId` are dropped SILENTLY, with no fault, and
 * properties in the same payload still apply. Otherwise as an entity
 * update; the write is null when the payload changes nothing.
 */
export function prepareUpdateRelation(
  loaded: LoadedSchema,
  relationTypeKey: string,
  relationId: string,
  body: Row,
): Prepared<RelationUpdateArgs | null> {
  const scopedRt = scopedRelationType(loaded, relationTypeKey);

  const properties: Row = { ...body };
  delete properties.fromEntityId;
  delete properties.toEntityId;

  const [coerced, errors] = validateProperties(properties, scopedRt.properties, relationTypeKey, true);
  const { setProperties, removeProperties } = splitPatch(coerced);
  if (Object.keys(setProperties).length === 0 && removeProperties.length === 0) {
    return { errors, write: null };
  }

  const fullRt = loaded.full.relationTypes[relationTypeKey];
  return {
    errors,
    write: {
      relationTypeKey,
      relationId,
      setProperties,
      removeProperties,
      propertyDefs: fullRt?.properties ?? scopedRt.properties,
      change: { kind: "relationUpdated", relationType: relationTypeKey, relationId, changedKeys: Object.keys(coerced) },
    },
  };
}

/** A relation delete; neither endpoint is touched. */
export function prepareDeleteRelation(
  loaded: LoadedSchema,
  relationTypeKey: string,
  relationId: string,
): RelationDeleteArgs {
  scopedRelationType(loaded, relationTypeKey);
  return { relationTypeKey, relationId, change: { kind: "relationDeleted", relationType: relationTypeKey, relationId } };
}
