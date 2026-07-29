/**
 * Modeling service: every domain rule for the global schema — entity
 * types, relation types, property definitions. Ported from the type and
 * property portions of the Python reference
 * (`backend/src/ontoforge_server/modeling/service.py`); REST and MCP are
 * two entrances to these same functions, so no rule may live in a router.
 *
 * Two seams are called on every mutating path at the same points the
 * Python service calls them: schema-cache invalidation
 * (`runtime/schemaCache.ts`, filled in session 04) and the vector-index
 * lifecycle hooks (`vectorHooks.ts`, filled in session 08).
 */

import { randomUUID } from "node:crypto";

import {
  CascadeRequiredError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../core/exceptions.js";
import type { ModelingStore } from "../core/ports.js";
import { invalidateLoadedSchemaCache } from "../runtime/schemaCache.js";
import type {
  EntityTypeCreateInput,
  EntityTypeResponseBody,
  EntityTypeUpdateInput,
  PropertyDefinitionCreateInput,
  PropertyDefinitionResponseBody,
  PropertyDefinitionUpdateInput,
  RelationTypeCreateInput,
  RelationTypeResponseBody,
  RelationTypeUpdateInput,
} from "./schemas.js";
import {
  onEntityTypeCreated,
  onEntityTypeDeleted,
  onEntityTypePropertyCreated,
  onEntityTypePropertyDeleted,
} from "./vectorHooks.js";

/** The two property owners, in the port's owner-kind vocabulary. */
export type OwnerLabel = "EntityType" | "RelationType";

type Row = Record<string, unknown>;

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function optString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toEntityTypeResponse(data: Row): EntityTypeResponseBody {
  return {
    entityTypeId: data.entityTypeId as string,
    key: data.key as string,
    displayName: data.displayName as string,
    description: optString(data.description),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function toRelationTypeResponse(data: Row): RelationTypeResponseBody {
  return {
    relationTypeId: data.relationTypeId as string,
    key: data.key as string,
    displayName: data.displayName as string,
    description: optString(data.description),
    sourceEntityTypeKey: data.sourceEntityTypeKey as string,
    targetEntityTypeKey: data.targetEntityTypeKey as string,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function toPropertyResponse(data: Row): PropertyDefinitionResponseBody {
  return {
    propertyId: data.propertyId as string,
    key: data.key as string,
    displayName: data.displayName as string,
    description: optString(data.description),
    dataType: data.dataType as string,
    required: data.required as boolean,
    defaultValue: optString(data.defaultValue),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

/** Reject an entity type key the storage adapter reserves for its own objects. */
function rejectReservedEntityTypeKey(store: ModelingStore, key: string, context = ""): void {
  const reserved = store.reservedEntityTypeKeys();
  if (reserved.has(key)) {
    throw new ValidationError(
      `${context}Entity type key '${key}' is reserved for internal use and ` +
        "cannot name a user-defined type. Reserved entity type keys: " +
        [...reserved].sort().join(", "),
    );
  }
}

/** Reject a relation type key the storage adapter reserves for its own objects. */
function rejectReservedRelationTypeKey(store: ModelingStore, key: string, context = ""): void {
  const reserved = store.reservedRelationTypeKeys();
  if (reserved.has(key)) {
    throw new ValidationError(
      `${context}Relation type key '${key}' is reserved for internal use and ` +
        "cannot name a user-defined type. Reserved relation type keys: " +
        [...reserved].sort().join(", "),
    );
  }
}

// --- Entity Type (Global) ---

export async function createEntityType(
  body: EntityTypeCreateInput,
  store: ModelingStore,
): Promise<EntityTypeResponseBody> {
  rejectReservedEntityTypeKey(store, body.key);
  const existing = await store.getEntityTypeByKey(body.key);
  if (existing) {
    throw new ConflictError(`Entity type with key '${body.key}' already exists`);
  }
  const entityTypeId = randomUUID();
  const data = await store.createEntityType(
    entityTypeId,
    body.key,
    body.displayName,
    body.description ?? null,
  );
  invalidateLoadedSchemaCache();
  await onEntityTypeCreated(store, body.key);
  return toEntityTypeResponse(data);
}

export async function listEntityTypes(store: ModelingStore): Promise<EntityTypeResponseBody[]> {
  const rows = await store.listEntityTypes();
  return rows.map(toEntityTypeResponse);
}

export async function getEntityType(
  entityTypeId: string,
  store: ModelingStore,
): Promise<EntityTypeResponseBody> {
  const data = await store.getEntityType(entityTypeId);
  if (!data) {
    throw new NotFoundError(`Entity type '${entityTypeId}' not found`);
  }
  return toEntityTypeResponse(data);
}

export async function updateEntityType(
  entityTypeId: string,
  body: EntityTypeUpdateInput,
  store: ModelingStore,
): Promise<EntityTypeResponseBody> {
  const data = await store.updateEntityType(
    entityTypeId,
    body.displayName ?? null,
    body.description ?? null,
  );
  if (!data) {
    throw new NotFoundError(`Entity type '${entityTypeId}' not found`);
  }
  invalidateLoadedSchemaCache();
  return toEntityTypeResponse(data);
}

export async function deleteEntityType(
  entityTypeId: string,
  cascade: boolean,
  store: ModelingStore,
): Promise<void> {
  // Referenced by a relation type: unconditional conflict — cascade never
  // overrides it, there is no consenting to it.
  const referenced = await store.isEntityTypeReferenced(entityTypeId);
  if (referenced) {
    throw new ConflictError(
      `Entity type '${entityTypeId}' is referenced by one or more relation types`,
    );
  }
  // Included by scoped lenses: the cascade protocol (lenses arrive in
  // session 03; without them this can never trigger).
  const affected = await store.findOntologiesIncludingType("EntityType", entityTypeId);
  if (affected.length > 0 && !cascade) {
    throw new CascadeRequiredError(
      `Entity type is included by ${affected.length} ontology(ies). Use ?cascade=true to remove.`,
      affected,
    );
  }
  if (affected.length > 0) {
    await store.removeAllIncludesForType("EntityType", entityTypeId);
  }

  // Key and properties are needed by the vector-index hook after the
  // delete has removed them.
  const etData = await store.getEntityType(entityTypeId);
  const etProps = etData ? await store.listProperties(entityTypeId, "EntityType") : [];
  const deleted = await store.deleteEntityType(entityTypeId);
  if (!deleted) {
    throw new NotFoundError(`Entity type '${entityTypeId}' not found`);
  }
  invalidateLoadedSchemaCache();
  if (etData) {
    await onEntityTypeDeleted(store, etData.key as string, etProps);
  }
}

// --- Relation Type (Global) ---

export async function createRelationType(
  body: RelationTypeCreateInput,
  store: ModelingStore,
): Promise<RelationTypeResponseBody> {
  rejectReservedRelationTypeKey(store, body.key);
  const existing = await store.getRelationTypeByKey(body.key);
  if (existing) {
    throw new ConflictError(`Relation type with key '${body.key}' already exists`);
  }
  // Endpoints must exist at creation, and are immutable forever after.
  const source = await store.getEntityTypeByKey(body.sourceEntityTypeKey);
  if (!source) {
    throw new ValidationError(`Source entity type '${body.sourceEntityTypeKey}' not found`);
  }
  const target = await store.getEntityTypeByKey(body.targetEntityTypeKey);
  if (!target) {
    throw new ValidationError(`Target entity type '${body.targetEntityTypeKey}' not found`);
  }
  const relationTypeId = randomUUID();
  const data = await store.createRelationType(
    relationTypeId,
    body.key,
    body.displayName,
    body.description ?? null,
    body.sourceEntityTypeKey,
    body.targetEntityTypeKey,
  );
  invalidateLoadedSchemaCache();
  return toRelationTypeResponse(data);
}

export async function listRelationTypes(
  store: ModelingStore,
): Promise<RelationTypeResponseBody[]> {
  const rows = await store.listRelationTypes();
  return rows.map(toRelationTypeResponse);
}

export async function getRelationType(
  relationTypeId: string,
  store: ModelingStore,
): Promise<RelationTypeResponseBody> {
  const data = await store.getRelationType(relationTypeId);
  if (!data) {
    throw new NotFoundError(`Relation type '${relationTypeId}' not found`);
  }
  return toRelationTypeResponse(data);
}

export async function updateRelationType(
  relationTypeId: string,
  body: RelationTypeUpdateInput,
  store: ModelingStore,
): Promise<RelationTypeResponseBody> {
  const data = await store.updateRelationType(
    relationTypeId,
    body.displayName ?? null,
    body.description ?? null,
  );
  if (!data) {
    throw new NotFoundError(`Relation type '${relationTypeId}' not found`);
  }
  invalidateLoadedSchemaCache();
  return toRelationTypeResponse(data);
}

export async function deleteRelationType(
  relationTypeId: string,
  cascade: boolean,
  store: ModelingStore,
): Promise<void> {
  const affected = await store.findOntologiesIncludingType("RelationType", relationTypeId);
  if (affected.length > 0 && !cascade) {
    throw new CascadeRequiredError(
      `Relation type is included by ${affected.length} ontology(ies). Use ?cascade=true to remove.`,
      affected,
    );
  }
  if (affected.length > 0) {
    await store.removeAllIncludesForType("RelationType", relationTypeId);
  }
  const deleted = await store.deleteRelationType(relationTypeId);
  if (!deleted) {
    throw new NotFoundError(`Relation type '${relationTypeId}' not found`);
  }
  invalidateLoadedSchemaCache();
}

// --- Property Definition ---

async function ensureOwnerExists(
  store: ModelingStore,
  ownerId: string,
  ownerLabel: OwnerLabel,
): Promise<void> {
  if (ownerLabel === "EntityType") {
    const data = await store.getEntityType(ownerId);
    if (!data) {
      throw new NotFoundError(`Entity type '${ownerId}' not found`);
    }
  } else {
    const data = await store.getRelationType(ownerId);
    if (!data) {
      throw new NotFoundError(`Relation type '${ownerId}' not found`);
    }
  }
}

export async function createProperty(
  ownerId: string,
  ownerLabel: OwnerLabel,
  body: PropertyDefinitionCreateInput,
  cascade: boolean,
  store: ModelingStore,
): Promise<PropertyDefinitionResponseBody> {
  if (ownerLabel === "RelationType" && body.dataType === "document") {
    throw new ValidationError("Document properties are only supported on entity types");
  }
  await ensureOwnerExists(store, ownerId, ownerLabel);
  const existing = await store.getPropertyByKey(ownerId, ownerLabel, body.key);
  if (existing) {
    throw new ConflictError(`Property with key '${body.key}' already exists on this type`);
  }
  // Cascade check: adding a required property without a default breaks
  // every lens whose explicit allowlist for this type omits the new key.
  if (body.required && (body.defaultValue === null || body.defaultValue === undefined)) {
    const affected = await store.findOntologiesWithExplicitProperty(
      ownerLabel,
      ownerId,
      body.key,
    );
    if (affected.length > 0 && !cascade) {
      throw new CascadeRequiredError(
        `Adding required property '${body.key}' without default would break ` +
          `${affected.length} ontology(ies). ` +
          "Use ?cascade=true to auto-add to explicit property lists.",
        affected,
      );
    }
    if (affected.length > 0) {
      await store.addPropertyToIncludesLists(ownerLabel, ownerId, body.key);
    }
  }
  const propertyId = randomUUID();
  const data = await store.createProperty(
    ownerId,
    ownerLabel,
    propertyId,
    body.key,
    body.displayName,
    body.description ?? null,
    body.dataType,
    body.required,
    body.defaultValue ?? null,
  );
  invalidateLoadedSchemaCache();
  if (ownerLabel === "EntityType") {
    await onEntityTypePropertyCreated(store, ownerId, data);
  }
  return toPropertyResponse(data);
}

export async function listProperties(
  ownerId: string,
  ownerLabel: OwnerLabel,
  store: ModelingStore,
): Promise<PropertyDefinitionResponseBody[]> {
  await ensureOwnerExists(store, ownerId, ownerLabel);
  const rows = await store.listProperties(ownerId, ownerLabel);
  return rows.map(toPropertyResponse);
}

export async function updateProperty(
  ownerId: string,
  ownerLabel: OwnerLabel,
  propertyId: string,
  body: PropertyDefinitionUpdateInput,
  store: ModelingStore,
): Promise<PropertyDefinitionResponseBody> {
  await ensureOwnerExists(store, ownerId, ownerLabel);
  // An explicitly null defaultValue clears the default — the one exception
  // to sparse-update semantics. Omitted (`undefined`) means unchanged.
  const clearDefault = body.defaultValue === null;
  const data = await store.updateProperty(
    ownerId,
    ownerLabel,
    propertyId,
    body.displayName ?? null,
    body.description ?? null,
    body.required ?? null,
    body.defaultValue ?? null,
    clearDefault,
  );
  if (!data) {
    throw new NotFoundError(`Property '${propertyId}' not found on this type`);
  }
  invalidateLoadedSchemaCache();
  return toPropertyResponse(data);
}

export async function deleteProperty(
  ownerId: string,
  ownerLabel: OwnerLabel,
  propertyId: string,
  cascade: boolean,
  store: ModelingStore,
): Promise<void> {
  await ensureOwnerExists(store, ownerId, ownerLabel);
  const prop = await store.getProperty(ownerId, ownerLabel, propertyId);
  if (!prop) {
    throw new NotFoundError(`Property '${propertyId}' not found on this type`);
  }
  // Deleting a property never triggers the cascade protocol — without
  // cascade, allowlists are left holding an unresolvable key (harmless at
  // runtime, reported by lens validation). The Python service performs the
  // same lookup without acting on its result; kept for behavioral parity.
  await store.findOntologiesIncludingType(ownerLabel, ownerId);
  if (cascade) {
    await store.removePropertyFromIncludesLists(ownerLabel, ownerId, prop.key as string);
  }
  const deleted = await store.deleteProperty(ownerId, ownerLabel, propertyId);
  if (!deleted) {
    throw new NotFoundError(`Property '${propertyId}' not found on this type`);
  }
  invalidateLoadedSchemaCache();
  if (ownerLabel === "EntityType") {
    await onEntityTypePropertyDeleted(store, ownerId, prop);
  }
}

// --- Whole-schema read (transfer format) ---

/**
 * The whole global schema in the transfer format
 * (`docs/capabilities/transfer.md`) — the payload the modeling MCP
 * `get_schema` tool returns. Built from the store's full-schema snapshot.
 *
 * `ontologies` is empty until session 10 delivers export; session 10
 * asserts this payload equals the export payload exactly.
 */
export async function getSchemaExport(store: ModelingStore): Promise<Row> {
  const schema = await store.getFullSchema();

  const exportProperty = (p: Row): Row => ({
    key: p.key,
    displayName: p.displayName,
    description: optString(p.description),
    dataType: p.dataType,
    required: p.required,
    defaultValue: optString(p.defaultValue),
  });

  const entityTypes = (schema.entityTypes as Row[]).map((et) => ({
    key: et.key,
    displayName: et.displayName,
    description: optString(et.description),
    properties: ((et.properties as Row[] | undefined) ?? []).map(exportProperty),
  }));

  const relationTypes = (schema.relationTypes as Row[]).map((rt) => ({
    key: rt.key,
    displayName: rt.displayName,
    description: optString(rt.description),
    fromEntityTypeKey: rt.sourceKey,
    toEntityTypeKey: rt.targetKey,
    properties: ((rt.properties as Row[] | undefined) ?? []).map(exportProperty),
  }));

  return {
    formatVersion: "3.0",
    entityTypes,
    relationTypes,
    ontologies: [],
  };
}
