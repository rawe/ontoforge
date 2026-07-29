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

import { getEmbeddingProvider } from "../core/embedding.js";
import {
  CascadeRequiredError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../core/exceptions.js";
import type { ModelingStore, RuntimeStore } from "../core/ports.js";
import { DATA_TYPES } from "../core/schemas.js";
import { buildTextRepr } from "../runtime/embedding.js";
import { invalidateLoadedSchemaCache, type PropertyDef } from "../runtime/schemaCache.js";
import { syncDocumentChunks } from "../runtime/service.js";
import type {
  EntityTypeCreateInput,
  EntityTypeResponseBody,
  EntityTypeUpdateInput,
  IncludeTypeRequestInput,
  IncludeTypeResponseBody,
  IncludeTypeUpdateInput,
  OntologyCreateInput,
  OntologyResponseBody,
  OntologyUpdateInput,
  PropertyDefinitionCreateInput,
  PropertyDefinitionResponseBody,
  PropertyDefinitionUpdateInput,
  RelationTypeCreateInput,
  RelationTypeResponseBody,
  RelationTypeUpdateInput,
  ValidationResultBody,
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

function toOntologyResponse(data: Row): OntologyResponseBody {
  return {
    ontologyId: data.ontologyId as string,
    key: data.key as string,
    name: data.name as string,
    description: optString(data.description),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

// --- Ontology ---

export async function createOntology(
  body: OntologyCreateInput,
  store: ModelingStore,
): Promise<OntologyResponseBody> {
  const existingKey = await store.getOntologyByKey(body.key);
  if (existingKey) {
    throw new ConflictError(`Ontology with key '${body.key}' already exists`);
  }
  const existing = await store.getOntologyByName(body.name);
  if (existing) {
    throw new ConflictError(`Ontology with name '${body.name}' already exists`);
  }
  const ontologyId = randomUUID();
  const data = await store.createOntology(ontologyId, body.key, body.name, body.description ?? null);
  invalidateLoadedSchemaCache();
  return toOntologyResponse(data);
}

export async function listOntologies(store: ModelingStore): Promise<OntologyResponseBody[]> {
  const rows = await store.listOntologies();
  return rows.map(toOntologyResponse);
}

export async function getOntology(
  ontologyId: string,
  store: ModelingStore,
): Promise<OntologyResponseBody> {
  const data = await store.getOntology(ontologyId);
  if (!data) {
    throw new NotFoundError(`Ontology '${ontologyId}' not found`);
  }
  return toOntologyResponse(data);
}

export async function updateOntology(
  ontologyId: string,
  body: OntologyUpdateInput,
  store: ModelingStore,
): Promise<OntologyResponseBody> {
  if (body.name !== null && body.name !== undefined) {
    const existing = await store.getOntologyByName(body.name);
    if (existing && existing.ontologyId !== ontologyId) {
      throw new ConflictError(`Ontology with name '${body.name}' already exists`);
    }
  }
  const data = await store.updateOntology(ontologyId, body.name ?? null, body.description ?? null);
  if (!data) {
    throw new NotFoundError(`Ontology '${ontologyId}' not found`);
  }
  invalidateLoadedSchemaCache();
  return toOntologyResponse(data);
}

/**
 * Lens deletion is always permitted: it cascades to nothing but the lens's
 * own agent configurations and saved queries (handled in the store), needs
 * no consent, and leaves the schema and every instance untouched.
 */
export async function deleteOntology(ontologyId: string, store: ModelingStore): Promise<void> {
  const deleted = await store.deleteOntology(ontologyId);
  if (!deleted) {
    throw new NotFoundError(`Ontology '${ontologyId}' not found`);
  }
  invalidateLoadedSchemaCache();
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

// --- Scope Management (inclusions) ---

async function resolveOntology(store: ModelingStore, ontologyId: string): Promise<Row> {
  const data = await store.getOntology(ontologyId);
  if (!data) {
    throw new NotFoundError(`Ontology '${ontologyId}' not found`);
  }
  return data;
}

function toIncludeResponse(data: Row): IncludeTypeResponseBody {
  return {
    key: data.key as string,
    properties: (data.properties as string[] | null) ?? null,
  };
}

export async function addIncludesEntityType(
  ontologyId: string,
  body: IncludeTypeRequestInput,
  store: ModelingStore,
): Promise<IncludeTypeResponseBody> {
  await resolveOntology(store, ontologyId);
  const et = await store.getEntityTypeByKey(body.key);
  if (!et) {
    throw new NotFoundError(`Entity type '${body.key}' not found`);
  }
  const properties = body.properties ?? null;
  if (properties !== null) {
    const etProps = await store.listProperties(et.entityTypeId as string, "EntityType");
    const validKeys = new Set(etProps.map((p) => p.key as string));
    for (const pk of properties) {
      if (!validKeys.has(pk)) {
        throw new ValidationError(`Property '${pk}' not found on entity type '${body.key}'`);
      }
    }
    // Every required property without a default must be in the allowlist —
    // otherwise creates through the lens could never satisfy it.
    for (const p of etProps) {
      if (
        p.required &&
        (p.defaultValue === null || p.defaultValue === undefined) &&
        !properties.includes(p.key as string)
      ) {
        throw new ValidationError(
          `Required property '${p.key}' without default must be included ` +
            `in the property list for entity type '${body.key}'`,
        );
      }
    }
  }
  const data = await store.addIncludesType(ontologyId, "EntityType", body.key, properties);
  if (!data) {
    throw new NotFoundError(`Failed to add inclusion for entity type '${body.key}'`);
  }
  invalidateLoadedSchemaCache();
  return toIncludeResponse(data);
}

export async function listIncludesEntityTypes(
  ontologyId: string,
  store: ModelingStore,
): Promise<IncludeTypeResponseBody[]> {
  await resolveOntology(store, ontologyId);
  const rows = await store.listIncludesTypes(ontologyId, "EntityType");
  return rows.map(toIncludeResponse);
}

export async function updateIncludesEntityType(
  ontologyId: string,
  typeId: string,
  body: IncludeTypeUpdateInput,
  store: ModelingStore,
): Promise<IncludeTypeResponseBody> {
  await resolveOntology(store, ontologyId);
  const et = await store.getEntityType(typeId);
  if (!et) {
    throw new NotFoundError(`Entity type '${typeId}' not found`);
  }
  const properties = body.properties ?? null;
  if (properties !== null) {
    const etProps = await store.listProperties(typeId, "EntityType");
    const validKeys = new Set(etProps.map((p) => p.key as string));
    for (const pk of properties) {
      if (!validKeys.has(pk)) {
        throw new ValidationError(`Property '${pk}' not found on entity type '${et.key}'`);
      }
    }
    for (const p of etProps) {
      if (
        p.required &&
        (p.defaultValue === null || p.defaultValue === undefined) &&
        !properties.includes(p.key as string)
      ) {
        throw new ValidationError(`Required property '${p.key}' without default must be included`);
      }
    }
  }
  const data = await store.updateIncludesType(ontologyId, "EntityType", typeId, properties);
  if (!data) {
    throw new NotFoundError(`Entity type '${typeId}' is not included in this ontology`);
  }
  invalidateLoadedSchemaCache();
  return toIncludeResponse(data);
}

export async function removeIncludesEntityType(
  ontologyId: string,
  typeId: string,
  store: ModelingStore,
): Promise<void> {
  await resolveOntology(store, ontologyId);
  const deleted = await store.removeIncludesType(ontologyId, "EntityType", typeId);
  if (!deleted) {
    throw new NotFoundError(`Entity type '${typeId}' is not included in this ontology`);
  }
  invalidateLoadedSchemaCache();
}

export async function addIncludesRelationType(
  ontologyId: string,
  body: IncludeTypeRequestInput,
  store: ModelingStore,
): Promise<IncludeTypeResponseBody> {
  await resolveOntology(store, ontologyId);
  const rt = await store.getRelationTypeByKey(body.key);
  if (!rt) {
    throw new NotFoundError(`Relation type '${body.key}' not found`);
  }
  // Endpoint check applies only when the lens ALREADY has entity inclusions
  // — a deliberately preserved ordering hazard: a lens with no entity
  // inclusions yet accepts any relation type inclusion unchecked, and
  // adding entity inclusions afterwards can leave an included relation
  // type whose endpoints are not exposed. Validation reports it; the
  // runtime still loads it.
  const entityInclusions = await store.listIncludesTypes(ontologyId, "EntityType");
  if (entityInclusions.length > 0) {
    const includedEtKeys = new Set(entityInclusions.map((inc) => inc.key as string));
    if (!includedEtKeys.has(rt.sourceEntityTypeKey as string)) {
      throw new ValidationError(
        `Source entity type '${rt.sourceEntityTypeKey}' of relation type '${body.key}' ` +
          "is not included in this ontology",
      );
    }
    if (!includedEtKeys.has(rt.targetEntityTypeKey as string)) {
      throw new ValidationError(
        `Target entity type '${rt.targetEntityTypeKey}' of relation type '${body.key}' ` +
          "is not included in this ontology",
      );
    }
  }
  const properties = body.properties ?? null;
  if (properties !== null) {
    const rtProps = await store.listProperties(rt.relationTypeId as string, "RelationType");
    const validKeys = new Set(rtProps.map((p) => p.key as string));
    for (const pk of properties) {
      if (!validKeys.has(pk)) {
        throw new ValidationError(`Property '${pk}' not found on relation type '${body.key}'`);
      }
    }
    for (const p of rtProps) {
      if (
        p.required &&
        (p.defaultValue === null || p.defaultValue === undefined) &&
        !properties.includes(p.key as string)
      ) {
        throw new ValidationError(
          `Required property '${p.key}' without default must be included ` +
            `in the property list for relation type '${body.key}'`,
        );
      }
    }
  }
  const data = await store.addIncludesType(ontologyId, "RelationType", body.key, properties);
  if (!data) {
    throw new NotFoundError(`Failed to add inclusion for relation type '${body.key}'`);
  }
  invalidateLoadedSchemaCache();
  return toIncludeResponse(data);
}

export async function listIncludesRelationTypes(
  ontologyId: string,
  store: ModelingStore,
): Promise<IncludeTypeResponseBody[]> {
  await resolveOntology(store, ontologyId);
  const rows = await store.listIncludesTypes(ontologyId, "RelationType");
  return rows.map(toIncludeResponse);
}

export async function updateIncludesRelationType(
  ontologyId: string,
  typeId: string,
  body: IncludeTypeUpdateInput,
  store: ModelingStore,
): Promise<IncludeTypeResponseBody> {
  await resolveOntology(store, ontologyId);
  const rt = await store.getRelationType(typeId);
  if (!rt) {
    throw new NotFoundError(`Relation type '${typeId}' not found`);
  }
  const properties = body.properties ?? null;
  if (properties !== null) {
    const rtProps = await store.listProperties(typeId, "RelationType");
    const validKeys = new Set(rtProps.map((p) => p.key as string));
    for (const pk of properties) {
      if (!validKeys.has(pk)) {
        throw new ValidationError(`Property '${pk}' not found on relation type '${rt.key}'`);
      }
    }
    for (const p of rtProps) {
      if (
        p.required &&
        (p.defaultValue === null || p.defaultValue === undefined) &&
        !properties.includes(p.key as string)
      ) {
        throw new ValidationError(`Required property '${p.key}' without default must be included`);
      }
    }
  }
  const data = await store.updateIncludesType(ontologyId, "RelationType", typeId, properties);
  if (!data) {
    throw new NotFoundError(`Relation type '${typeId}' is not included in this ontology`);
  }
  invalidateLoadedSchemaCache();
  return toIncludeResponse(data);
}

export async function removeIncludesRelationType(
  ontologyId: string,
  typeId: string,
  store: ModelingStore,
): Promise<void> {
  await resolveOntology(store, ontologyId);
  const deleted = await store.removeIncludesType(ontologyId, "RelationType", typeId);
  if (!deleted) {
    throw new NotFoundError(`Relation type '${typeId}' is not included in this ontology`);
  }
  invalidateLoadedSchemaCache();
}

// --- Schema Validation ---

interface SchemaValidationErrorItem {
  path: string;
  message: string;
}

/**
 * Validate the global schema half: the same four conditions the create
 * paths already prevent — duplicate type keys, duplicate property keys
 * within one type, an unknown data type, and a relation endpoint that does
 * not exist. The pass earns its place because import does not check them.
 */
export async function validateSchema(store: ModelingStore): Promise<ValidationResultBody> {
  const schema = await store.getFullSchema();

  const errors: SchemaValidationErrorItem[] = [];
  const validDataTypes = new Set<string>(DATA_TYPES);

  const etKeys = new Set<string>();
  for (const et of schema.entityTypes as Row[]) {
    const etKey = et.key as string;
    if (etKeys.has(etKey)) {
      errors.push({
        path: `entityTypes.${etKey}`,
        message: `Duplicate entity type key '${etKey}'`,
      });
    }
    etKeys.add(etKey);
    const propKeys = new Set<string>();
    for (const p of (et.properties as Row[] | undefined) ?? []) {
      const pKey = p.key as string;
      if (propKeys.has(pKey)) {
        errors.push({
          path: `entityTypes.${etKey}.properties.${pKey}`,
          message: `Duplicate property key '${pKey}'`,
        });
      }
      propKeys.add(pKey);
      if (!validDataTypes.has(p.dataType as string)) {
        errors.push({
          path: `entityTypes.${etKey}.properties.${pKey}`,
          message: `Invalid data type '${p.dataType}'`,
        });
      }
    }
  }

  const rtKeys = new Set<string>();
  for (const rt of schema.relationTypes as Row[]) {
    const rtKey = rt.key as string;
    if (rtKeys.has(rtKey)) {
      errors.push({
        path: `relationTypes.${rtKey}`,
        message: `Duplicate relation type key '${rtKey}'`,
      });
    }
    rtKeys.add(rtKey);
    if (!etKeys.has(rt.sourceKey as string)) {
      errors.push({
        path: `relationTypes.${rtKey}`,
        message: `Source entity type '${rt.sourceKey}' does not exist`,
      });
    }
    if (!etKeys.has(rt.targetKey as string)) {
      errors.push({
        path: `relationTypes.${rtKey}`,
        message: `Target entity type '${rt.targetKey}' does not exist`,
      });
    }
    const propKeys = new Set<string>();
    for (const p of (rt.properties as Row[] | undefined) ?? []) {
      const pKey = p.key as string;
      if (propKeys.has(pKey)) {
        errors.push({
          path: `relationTypes.${rtKey}.properties.${pKey}`,
          message: `Duplicate property key '${pKey}'`,
        });
      }
      propKeys.add(pKey);
      if (!validDataTypes.has(p.dataType as string)) {
        errors.push({
          path: `relationTypes.${rtKey}.properties.${pKey}`,
          message: `Invalid data type '${p.dataType}'`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate one lens's declarations against the schema. An unscoped lens —
 * no inclusions — is valid by definition. Always answers, never raises
 * (except for an unknown lens id).
 */
export async function validateOntology(
  ontologyId: string,
  store: ModelingStore,
): Promise<ValidationResultBody> {
  const ont = await store.getOntology(ontologyId);
  if (!ont) {
    throw new NotFoundError(`Ontology '${ontologyId}' not found`);
  }

  const schema = await store.getFullSchema();

  const errors: SchemaValidationErrorItem[] = [];
  const ontologyKey = ont.key as string;

  const ontData = (schema.ontologies as Row[]).find((o) => o.ontologyId === ontologyId);
  if (!ontData) {
    return { valid: true, errors: [] };
  }

  const entityInclusions = (ontData.entityInclusions as Row[] | undefined) ?? [];
  const relationInclusions = (ontData.relationInclusions as Row[] | undefined) ?? [];

  if (entityInclusions.length === 0 && relationInclusions.length === 0) {
    return { valid: true, errors: [] };
  }

  const etMap = new Map((schema.entityTypes as Row[]).map((et) => [et.key as string, et]));
  const rtMap = new Map((schema.relationTypes as Row[]).map((rt) => [rt.key as string, rt]));

  const includedEtKeys = new Set<string>();
  for (const inc of entityInclusions) {
    const incKey = inc.key as string;
    const et = etMap.get(incKey);
    if (!et) {
      errors.push({
        path: `ontologies.${ontologyKey}.includes.entityTypes.${incKey}`,
        message: `Entity type '${incKey}' does not exist`,
      });
      continue;
    }
    includedEtKeys.add(incKey);
    const allowlist = (inc.properties as string[] | null) ?? null;
    if (allowlist !== null) {
      const etProps = (et.properties as Row[] | undefined) ?? [];
      const validProps = new Set(etProps.map((p) => p.key as string));
      for (const pk of allowlist) {
        if (!validProps.has(pk)) {
          errors.push({
            path: `ontologies.${ontologyKey}.includes.entityTypes.${incKey}.properties`,
            message: `Property '${pk}' does not exist on entity type '${incKey}'`,
          });
        }
      }
      for (const p of etProps) {
        if (
          p.required &&
          (p.defaultValue === null || p.defaultValue === undefined) &&
          !allowlist.includes(p.key as string)
        ) {
          errors.push({
            path: `ontologies.${ontologyKey}.includes.entityTypes.${incKey}.properties`,
            message: `Required property '${p.key}' without default must be included`,
          });
        }
      }
    }
  }

  for (const inc of relationInclusions) {
    const incKey = inc.key as string;
    const rt = rtMap.get(incKey);
    if (!rt) {
      errors.push({
        path: `ontologies.${ontologyKey}.includes.relationTypes.${incKey}`,
        message: `Relation type '${incKey}' does not exist`,
      });
      continue;
    }
    // Endpoint exposure re-checked here — the one place the ordering
    // hazard from addIncludesRelationType is reported.
    if (includedEtKeys.size > 0) {
      if (!includedEtKeys.has(rt.sourceKey as string)) {
        errors.push({
          path: `ontologies.${ontologyKey}.includes.relationTypes.${incKey}`,
          message: `Source entity type '${rt.sourceKey}' is not included`,
        });
      }
      if (!includedEtKeys.has(rt.targetKey as string)) {
        errors.push({
          path: `ontologies.${ontologyKey}.includes.relationTypes.${incKey}`,
          message: `Target entity type '${rt.targetKey}' is not included`,
        });
      }
    }
    const allowlist = (inc.properties as string[] | null) ?? null;
    if (allowlist !== null) {
      const rtProps = (rt.properties as Row[] | undefined) ?? [];
      const validProps = new Set(rtProps.map((p) => p.key as string));
      for (const pk of allowlist) {
        if (!validProps.has(pk)) {
          errors.push({
            path: `ontologies.${ontologyKey}.includes.relationTypes.${incKey}.properties`,
            message: `Property '${pk}' does not exist on relation type '${incKey}'`,
          });
        }
      }
      for (const p of rtProps) {
        if (
          p.required &&
          (p.defaultValue === null || p.defaultValue === undefined) &&
          !allowlist.includes(p.key as string)
        ) {
          errors.push({
            path: `ontologies.${ontologyKey}.includes.relationTypes.${incKey}.properties`,
            message: `Required property '${p.key}' without default must be included`,
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Validate the global schema and then every lens: one combined list. */
export async function validateAll(store: ModelingStore): Promise<ValidationResultBody> {
  const schemaResult = await validateSchema(store);
  const errors = [...schemaResult.errors];

  const ontologies = await store.listOntologies();
  for (const ont of ontologies) {
    const ontResult = await validateOntology(ont.ontologyId as string, store);
    errors.push(...ontResult.errors);
  }

  return { valid: errors.length === 0, errors };
}

// --- Rebuild embeddings ---

// Page size for iterating all entities of a type during embedding rebuild.
const REBUILD_PAGE_SIZE = 500;

/**
 * Re-embed all entities, document chunks, and saved-query descriptions.
 * Yields NDJSON progress lines (`docs/capabilities/search.md#rebuild`):
 * one progress record per processed item carrying the group's type key,
 * the count so far and the group total, then a final summary with
 * per-type processed/failed counts and the overall totals.
 */
export async function* rebuildEmbeddings(
  store: ModelingStore,
  runtimeStore: RuntimeStore,
): AsyncGenerator<string> {
  const provider = getEmbeddingProvider();
  if (!provider) {
    throw new ValidationError(
      "Embedding provider is not configured. Set EMBEDDING_PROVIDER to enable semantic search.",
    );
  }

  // Ensure all semantic indexes exist. This is the one path allowed to
  // recreate an index whose width no longer matches the provider: the
  // vectors it drops are regenerated by the rebuild that follows.
  await store.ensureVectorIndexes(provider.dimensions, true);

  // Discover all entity types with their property definitions.
  const entityTypes: { key: string; properties: Record<string, PropertyDef> }[] = [];
  for (const raw of await store.getEntityTypesWithProperties()) {
    const props: Record<string, PropertyDef> = {};
    for (const p of raw.properties as Row[]) {
      props[p.key as string] = {
        key: p.key as string,
        displayName: (p.displayName as string | undefined) ?? (p.key as string),
        description: (p.description as string | undefined) ?? null,
        dataType: (p.dataType as string | undefined) ?? "string",
        required: (p.required as boolean | undefined) ?? false,
        defaultValue: (p.defaultValue as string | undefined) ?? null,
      };
    }
    entityTypes.push({ key: raw.key as string, properties: props });
  }

  // For each entity type, iterate all entities and re-embed.
  const typeResults: Row[] = [];
  let totalProcessed = 0;
  let totalFailed = 0;

  for (const et of entityTypes) {
    const etKey = et.key;
    const propertyDefs = et.properties;

    // Page through all entities of this type.
    const records: Row[] = [];
    let entityTotal = 0;
    let offset = 0;
    for (;;) {
      const [items, total] = await runtimeStore.listEntities(
        etKey,
        {},
        {},
        null,
        [],
        "_createdAt",
        "asc",
        REBUILD_PAGE_SIZE,
        offset,
      );
      records.push(...items);
      entityTotal = total;
      offset += REBUILD_PAGE_SIZE;
      if (items.length === 0 || offset >= entityTotal) {
        break;
      }
    }

    let processed = 0;
    let failed = 0;

    const docPropKeys = Object.entries(propertyDefs)
      .filter(([, p]) => p.dataType === "document")
      .map(([k]) => k);

    for (const record of records) {
      const entityId = record._id as string;
      const userProps: Row = {};
      for (const [k, v] of Object.entries(record)) {
        if (!k.startsWith("_")) {
          userProps[k] = v;
        }
      }

      const text = buildTextRepr(etKey, userProps, propertyDefs);
      const embedding = await provider.embed(text);

      if (embedding !== null) {
        await store.setEntityEmbedding(entityId, embedding);
        processed += 1;
      } else {
        failed += 1;
      }

      // Rebuild document chunks (delete + re-chunk + re-embed).
      if (docPropKeys.length > 0) {
        const docValues: Row = {};
        for (const k of docPropKeys) {
          docValues[k] = userProps[k] ?? null;
        }
        await syncDocumentChunks(runtimeStore, etKey, entityId, docValues);
      }

      yield `${JSON.stringify({
        type: "progress",
        entityTypeKey: etKey,
        processed: processed + failed,
        total: entityTotal,
      })}\n`;
    }

    typeResults.push({ entityTypeKey: etKey, processed, failed });
    totalProcessed += processed;
    totalFailed += failed;
  }

  // Re-embed saved queries (empty list until session 09 stores them).
  const savedQueries = await store.listSavedQueryRefs();

  const sqTotal = savedQueries.length;
  let sqProcessed = 0;
  let sqFailed = 0;

  for (const sq of savedQueries) {
    const embedding = await provider.embed(sq.description as string);
    if (embedding !== null) {
      await store.setSavedQueryEmbedding(sq.savedQueryId as string, embedding);
      sqProcessed += 1;
    } else {
      sqFailed += 1;
    }

    yield `${JSON.stringify({
      type: "progress",
      entityTypeKey: "saved_queries",
      processed: sqProcessed + sqFailed,
      total: sqTotal,
    })}\n`;
  }

  totalProcessed += sqProcessed;
  totalFailed += sqFailed;

  // Final summary.
  yield `${JSON.stringify({
    type: "summary",
    entityTypes: typeResults,
    savedQueriesProcessed: sqProcessed,
    savedQueriesFailed: sqFailed,
    totalProcessed,
    totalFailed,
  })}\n`;

  console.info(
    `Rebuild embeddings complete: ${totalProcessed} processed, ${totalFailed} failed`,
  );
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
