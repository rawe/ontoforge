/**
 * Modeling service: every domain rule for the global schema — entity
 * types, relation types, property definitions. REST and MCP are two
 * entrances to these same functions, so no rule may live in a router.
 *
 * Two seams are called on every mutating path: schema-cache invalidation
 * (`runtime/schemaCache.ts`) and the vector-index lifecycle hooks
 * (`vectorHooks.ts`).
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getEmbeddingProvider } from "../core/embedding.js";
import {
  CascadeRequiredError,
  ConflictError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "../core/exceptions.js";
import { parseAndValidate } from "../core/oql/index.js";
import type { ModelingStore, RuntimeStore } from "../core/ports.js";
import {
  DATA_TYPES,
  KEY_PATTERN,
  MAX_KEY_LENGTH,
  type PropertyDef,
  type TypeKind,
} from "../core/schemas.js";
import { buildTextRepr } from "../runtime/embedding.js";
import { invalidateLoadedSchemaCache, loadSchema } from "../runtime/schemaCache.js";
import { syncDocumentChunks } from "../runtime/service.js";
import { VALID_AGENT_TOOLS } from "../runtime/toolNames.js";
import {
  AGENT_KEY_PATTERN,
  StepSchema as StepZodSchema,
  TRANSFER_FORMAT_VERSION,
} from "./schemas.js";
import type {
  ExportPayloadInput,
  AiAgentConfigResponseBody,
  AiAgentConfigUpsertInput,
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
  SavedQueryResponseBody,
  SavedQueryUpsertInput,
  StepInput,
  StepResponseBody,
  ValidationResultBody,
} from "./schemas.js";
import {
  onEntityTypeCreated,
  onEntityTypeDeleted,
  onEntityTypePropertyCreated,
  onEntityTypePropertyDeleted,
} from "./vectorHooks.js";

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
  // Included by scoped lenses: the cascade protocol.
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
  typeKind: TypeKind,
): Promise<void> {
  if (typeKind === "EntityType") {
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
  typeKind: TypeKind,
  body: PropertyDefinitionCreateInput,
  cascade: boolean,
  store: ModelingStore,
): Promise<PropertyDefinitionResponseBody> {
  if (typeKind === "RelationType" && body.dataType === "document") {
    throw new ValidationError("Document properties are only supported on entity types");
  }
  await ensureOwnerExists(store, ownerId, typeKind);
  const existing = await store.getPropertyByKey(ownerId, typeKind, body.key);
  if (existing) {
    throw new ConflictError(`Property with key '${body.key}' already exists on this type`);
  }
  // Cascade check: adding a required property without a default breaks
  // every lens whose explicit allowlist for this type omits the new key.
  if (body.required && (body.defaultValue === null || body.defaultValue === undefined)) {
    const affected = await store.findOntologiesWithExplicitProperty(
      typeKind,
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
      await store.addPropertyToIncludesLists(typeKind, ownerId, body.key);
    }
  }
  const propertyId = randomUUID();
  const data = await store.createProperty(
    ownerId,
    typeKind,
    propertyId,
    body.key,
    body.displayName,
    body.description ?? null,
    body.dataType,
    body.required,
    body.defaultValue ?? null,
  );
  invalidateLoadedSchemaCache();
  if (typeKind === "EntityType") {
    await onEntityTypePropertyCreated(store, ownerId, data);
  }
  return toPropertyResponse(data);
}

export async function listProperties(
  ownerId: string,
  typeKind: TypeKind,
  store: ModelingStore,
): Promise<PropertyDefinitionResponseBody[]> {
  await ensureOwnerExists(store, ownerId, typeKind);
  const rows = await store.listProperties(ownerId, typeKind);
  return rows.map(toPropertyResponse);
}

export async function updateProperty(
  ownerId: string,
  typeKind: TypeKind,
  propertyId: string,
  body: PropertyDefinitionUpdateInput,
  store: ModelingStore,
): Promise<PropertyDefinitionResponseBody> {
  await ensureOwnerExists(store, ownerId, typeKind);
  // An explicitly null defaultValue clears the default — the one exception
  // to sparse-update semantics. Omitted (`undefined`) means unchanged.
  const clearDefault = body.defaultValue === null;
  const data = await store.updateProperty(
    ownerId,
    typeKind,
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
  typeKind: TypeKind,
  propertyId: string,
  cascade: boolean,
  store: ModelingStore,
): Promise<void> {
  await ensureOwnerExists(store, ownerId, typeKind);
  const prop = await store.getProperty(ownerId, typeKind, propertyId);
  if (!prop) {
    throw new NotFoundError(`Property '${propertyId}' not found on this type`);
  }
  // Deleting a property never triggers the cascade protocol — without
  // cascade, allowlists are left holding an unresolvable key (harmless at
  // runtime, reported by lens validation). The lookup runs anyway so the
  // call fails here if the owner has vanished; its result is not acted on.
  await store.findOntologiesIncludingType(typeKind, ownerId);
  if (cascade) {
    await store.removePropertyFromIncludesLists(typeKind, ownerId, prop.key as string);
  }
  const deleted = await store.deleteProperty(ownerId, typeKind, propertyId);
  if (!deleted) {
    throw new NotFoundError(`Property '${propertyId}' not found on this type`);
  }
  invalidateLoadedSchemaCache();
  if (typeKind === "EntityType") {
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

  // Re-embed every saved-query description.
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

/** Stored steps/parameters JSON text → parsed list (tolerates absent). */
function parseStoredJsonList(raw: unknown): Row[] {
  if (!raw) {
    return [];
  }
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as Row[];
}

/**
 * The whole global schema in the transfer format
 * (`docs/capabilities/transfer.md`): entity types, relation types,
 * ontologies with their inclusions, and each lens's agents and saved
 * queries — no timestamps, no internal ids, no instance data. This is both
 * the REST export payload and what the modeling MCP `get_schema` and
 * `export_schema` tools return.
 *
 * The `includes` key is ABSENT for an unscoped lens — "absent entirely",
 * not an explicit `null` (`docs/capabilities/transfer.md`).
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

  const ontologies: Row[] = [];
  for (const ont of schema.ontologies as Row[]) {
    const entityInclusions = (ont.entityInclusions as Row[] | undefined) ?? [];
    const relationInclusions = (ont.relationInclusions as Row[] | undefined) ?? [];

    const exported: Row = {
      key: ont.key,
      name: ont.name,
      description: optString(ont.description),
    };
    if (entityInclusions.length > 0 || relationInclusions.length > 0) {
      const exportInclusion = (inc: Row): Row => ({
        key: inc.key,
        properties: (inc.properties as string[] | null | undefined) ?? null,
      });
      exported.includes = {
        entityTypes: entityInclusions.map(exportInclusion),
        relationTypes: relationInclusions.map(exportInclusion),
      };
    }

    const agentRows = await store.listAiAgentsForExport(ont.ontologyId as string);
    exported.aiAgents = agentRows.map((ag) => ({
      key: ag.key,
      name: ag.name,
      description: optString(ag.description),
      systemPrompt: optString(ag.systemPrompt),
      tools: (ag.tools as string[] | null | undefined) ?? null,
    }));

    const queryRows = await store.listSavedQueriesForExport(ont.ontologyId as string);
    exported.savedQueries = queryRows.map((sq) => ({
      key: sq.key,
      name: sq.name,
      description: sq.description,
      // Stored sparse; exported with every field, absent ones as explicit
      // null.
      steps: parseStoredJsonList(sq.steps).map(toStepResponse),
      parameters: parseStoredJsonList(sq.parameters).map((p) => ({
        name: p.name,
        description: p.description,
        dataType: p.dataType,
      })),
    }));

    ontologies.push(exported);
  }

  return {
    formatVersion: TRANSFER_FORMAT_VERSION,
    entityTypes,
    relationTypes,
    ontologies,
  };
}

// --- Import (transfer format) ---

/**
 * Import a transfer payload: create the types globally, then the lenses
 * with their inclusions, agents and saved queries.
 *
 * Validate-then-write: the ENTIRE payload is
 * validated before anything is written — every rule violation collected
 * into one 422, every key conflict into one 409 — and a rejected import
 * leaves the database untouched. Rule violations are reported before
 * conflicts: they are intrinsic to the payload file, while conflicts
 * depend on the target. Only a clean payload starts writing; a crash
 * mid-write can still leave partial state (accepted residual — index DDL,
 * data writes and embedding calls cannot share one transaction).
 *
 * Every imported key is validated against the same patterns the
 * interactive paths enforce, closing the `_id`-property hole
 * `docs/architecture.md` documents. Property data types are deliberately
 * NOT checked against the enum — the schema-validation operation catches
 * that later (`docs/capabilities/transfer.md`).
 *
 * The payload version is informational: old, unknown and missing versions
 * process identically.
 */
export async function importSchema(
  payload: ExportPayloadInput,
  store: ModelingStore,
): Promise<Row> {
  // ---- Phase 1: payload-intrinsic validation (collect everything) ----
  const errors: string[] = [];

  const pushReserved = (reject: () => void): void => {
    try {
      reject();
    } catch (exc) {
      if (exc instanceof ValidationError) {
        errors.push(exc.message);
      } else {
        throw exc;
      }
    }
  };
  const badKey = (kind: string, key: string, pattern: string): string =>
    `Import error: invalid ${kind} key '${key}'. Must match pattern: ${pattern}`;
  const longKey = (kind: string, key: string): string =>
    `Import error: invalid ${kind} key '${key}'. ` +
    `Maximum length is ${MAX_KEY_LENGTH} characters`;
  const typeKeyPattern = KEY_PATTERN.source;

  for (const et of payload.entityTypes) {
    if (!KEY_PATTERN.test(et.key)) {
      errors.push(badKey("entity type", et.key, typeKeyPattern));
    }
    if (et.key.length > MAX_KEY_LENGTH) {
      errors.push(longKey("entity type", et.key));
    }
    pushReserved(() => rejectReservedEntityTypeKey(store, et.key, "Import error: "));
    for (const prop of et.properties) {
      if (!KEY_PATTERN.test(prop.key)) {
        errors.push(
          `Import error: invalid property key '${prop.key}' on entity type ` +
            `'${et.key}'. Must match pattern: ${typeKeyPattern}`,
        );
      }
      if (prop.key.length > MAX_KEY_LENGTH) {
        errors.push(
          `Import error: invalid property key '${prop.key}' on entity type ` +
            `'${et.key}'. Maximum length is ${MAX_KEY_LENGTH} characters`,
        );
      }
    }
  }

  const payloadEtKeys = new Set(payload.entityTypes.map((et) => et.key));
  for (const rt of payload.relationTypes) {
    if (!KEY_PATTERN.test(rt.key)) {
      errors.push(badKey("relation type", rt.key, typeKeyPattern));
    }
    if (rt.key.length > MAX_KEY_LENGTH) {
      errors.push(longKey("relation type", rt.key));
    }
    pushReserved(() => rejectReservedRelationTypeKey(store, rt.key, "Import error: "));
    // Endpoints must be present in the SAME payload — a type existing only
    // in the target would have conflicted anyway.
    if (!payloadEtKeys.has(rt.fromEntityTypeKey)) {
      errors.push(
        `Import error: source entity type key '${rt.fromEntityTypeKey}' not found`,
      );
    }
    if (!payloadEtKeys.has(rt.toEntityTypeKey)) {
      errors.push(
        `Import error: target entity type key '${rt.toEntityTypeKey}' not found`,
      );
    }
    for (const prop of rt.properties) {
      if (!KEY_PATTERN.test(prop.key)) {
        errors.push(
          `Import error: invalid property key '${prop.key}' on relation type ` +
            `'${rt.key}'. Must match pattern: ${typeKeyPattern}`,
        );
      }
      if (prop.key.length > MAX_KEY_LENGTH) {
        errors.push(
          `Import error: invalid property key '${prop.key}' on relation type ` +
            `'${rt.key}'. Maximum length is ${MAX_KEY_LENGTH} characters`,
        );
      }
      if (prop.dataType === "document") {
        errors.push(
          `Import error: property '${prop.key}' on relation type '${rt.key}' ` +
            "has data type 'document'; document properties are only supported " +
            "on entity types",
        );
      }
    }
  }

  for (const ont of payload.ontologies) {
    if (!KEY_PATTERN.test(ont.key)) {
      errors.push(badKey("ontology", ont.key, typeKeyPattern));
    }
    if (ont.key.length > MAX_KEY_LENGTH) {
      errors.push(longKey("ontology", ont.key));
    }
    for (const ag of ont.aiAgents) {
      if (!AGENT_KEY_REGEX.test(ag.key)) {
        errors.push(badKey("agent", ag.key, AGENT_KEY_PATTERN));
      }
      if (ag.key.length > MAX_KEY_LENGTH) {
        errors.push(longKey("agent", ag.key));
      }
      const tools = ag.tools ?? null;
      if (tools !== null) {
        const unknown = tools.filter((t) => !VALID_AGENT_TOOLS.has(t));
        if (unknown.length > 0) {
          const available = [...VALID_AGENT_TOOLS].sort();
          errors.push(
            `Import error: agent '${ag.key}' references unknown tool(s): ` +
              `${pyList(unknown)}. Available tools: ${pyList(available)}`,
          );
        }
      }
    }
    for (const sq of ont.savedQueries) {
      if (!AGENT_KEY_REGEX.test(sq.key)) {
        errors.push(badKey("saved query", sq.key, AGENT_KEY_PATTERN));
      }
      if (sq.key.length > MAX_KEY_LENGTH) {
        errors.push(longKey("saved query", sq.key));
      }
      let stepsKnown = true;
      for (const s of sq.steps) {
        if (s.type !== "oql" && s.type !== "semantic_search") {
          errors.push(
            `Import error: saved query '${sq.key}' has step '${s.name}' with ` +
              `unknown type '${s.type}'; expected oql or semantic_search`,
          );
          stepsKnown = false;
        }
      }
      for (const p of sq.parameters) {
        if (p.dataType === "document") {
          errors.push(
            `Import error: parameter '${p.name}' of saved query '${sq.key}' ` +
              "has data type 'document'; parameters must be scalar types",
          );
        }
      }
      if (stepsKnown) {
        // Structural validation identical to definition time — but NO OQL
        // lens check: an imported pipeline may fail at first run.
        const parsed = z.array(StepZodSchema).safeParse(sq.steps);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            errors.push(
              `Import error: saved query '${sq.key}' steps[${issue.path.join(".")}]: ` +
                issue.message,
            );
          }
        } else {
          try {
            validatePipeline(
              parsed.data,
              sq.parameters.map((p) => p.name),
              sq.key,
            );
          } catch (exc) {
            if (exc instanceof ValidationError) {
              const detailErrors = (exc.details?.errors as unknown[] | undefined) ?? [];
              errors.push(
                detailErrors.length > 0
                  ? `${exc.message}: ${detailErrors.map(String).join("; ")}`
                  : exc.message,
              );
            } else {
              throw exc;
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors.join("; "), { errors });
  }

  // ---- Phase 2: conflicts — all-or-fail, naming EVERY conflicting key ----
  // An intra-payload duplicate reports the same conflict a sequential
  // write of the payload would have produced.
  const conflicts: string[] = [];

  const seenEtKeys = new Set<string>();
  for (const et of payload.entityTypes) {
    if (seenEtKeys.has(et.key) || (await store.getEntityTypeByKey(et.key))) {
      conflicts.push(`Entity type with key '${et.key}' already exists`);
    }
    seenEtKeys.add(et.key);
  }
  const seenRtKeys = new Set<string>();
  for (const rt of payload.relationTypes) {
    if (seenRtKeys.has(rt.key) || (await store.getRelationTypeByKey(rt.key))) {
      conflicts.push(`Relation type with key '${rt.key}' already exists`);
    }
    seenRtKeys.add(rt.key);
  }
  const seenOntKeys = new Set<string>();
  for (const ont of payload.ontologies) {
    if (seenOntKeys.has(ont.key) || (await store.getOntologyByKey(ont.key))) {
      conflicts.push(`Ontology with key '${ont.key}' already exists`);
    }
    seenOntKeys.add(ont.key);
  }

  if (conflicts.length > 0) {
    throw new ConflictError(conflicts.join("; "));
  }

  // ---- Phase 3: write (internal ids regenerated, keys preserved) ----
  const provider = getEmbeddingProvider();

  for (const et of payload.entityTypes) {
    const etId = randomUUID();
    await store.createEntityType(etId, et.key, et.displayName, et.description ?? null);
    for (const prop of et.properties) {
      await store.createProperty(
        etId,
        "EntityType",
        randomUUID(),
        prop.key,
        prop.displayName,
        prop.description ?? null,
        prop.dataType,
        prop.required,
        prop.defaultValue ?? null,
      );
    }
    // Vector indexes for this entity type: non-document properties become
    // in-index filter properties; each document property gets its own
    // chunk index. Skipped entirely without a provider.
    if (provider) {
      const filterProps = et.properties
        .filter((prop) => prop.dataType !== "document")
        .map((prop) => prop.key);
      await store.createVectorIndex(et.key, provider.dimensions, filterProps);
      for (const prop of et.properties) {
        if (prop.dataType === "document") {
          await store.createDocumentVectorIndex(et.key, prop.key, provider.dimensions);
        }
      }
    }
  }

  for (const rt of payload.relationTypes) {
    const rtId = randomUUID();
    await store.createRelationType(
      rtId,
      rt.key,
      rt.displayName,
      rt.description ?? null,
      rt.fromEntityTypeKey,
      rt.toEntityTypeKey,
    );
    for (const prop of rt.properties) {
      await store.createProperty(
        rtId,
        "RelationType",
        randomUUID(),
        prop.key,
        prop.displayName,
        prop.description ?? null,
        prop.dataType,
        prop.required,
        prop.defaultValue ?? null,
      );
    }
  }

  const createdOntologies: OntologyResponseBody[] = [];
  for (const ont of payload.ontologies) {
    const ontId = randomUUID();
    const ontData = await store.createOntology(ontId, ont.key, ont.name, ont.description ?? null);

    // Inclusions are written WITHOUT the four inclusion rules — lens
    // validation reports any damage (`docs/capabilities/transfer.md`).
    if (ont.includes) {
      for (const inc of ont.includes.entityTypes) {
        await store.addIncludesType(ontId, "EntityType", inc.key, inc.properties ?? null);
      }
      for (const inc of ont.includes.relationTypes) {
        await store.addIncludesType(ontId, "RelationType", inc.key, inc.properties ?? null);
      }
    }

    for (const ag of ont.aiAgents) {
      await store.upsertAiAgent(
        ontId,
        randomUUID(),
        ag.key,
        ag.name,
        ag.description ?? null,
        ag.systemPrompt ?? null,
        ag.tools ?? null,
      );
    }

    for (const sq of ont.savedQueries) {
      const stepsJson = JSON.stringify(
        sq.steps.map((s) => ({
          name: s.name,
          type: s.type,
          ...(s.oql ? { oql: s.oql } : {}),
          ...(s.entityTypeKey ? { entityTypeKey: s.entityTypeKey } : {}),
          ...(s.query ? { query: s.query } : {}),
          ...(s.limit !== null && s.limit !== undefined ? { limit: s.limit } : {}),
          ...(s.minScore !== null && s.minScore !== undefined ? { minScore: s.minScore } : {}),
          ...(s.bindings && Object.keys(s.bindings).length > 0 ? { bindings: s.bindings } : {}),
        })),
      );
      const paramsJson = JSON.stringify(
        sq.parameters.map((p) => ({
          name: p.name,
          description: p.description,
          dataType: p.dataType,
        })),
      );
      // Each description is embedded as it is written, so imported queries
      // are semantically discoverable immediately.
      let embedding: number[] | null = null;
      if (provider) {
        embedding = await provider.embed(sq.description);
      }
      await store.upsertSavedQuery(
        ontId,
        randomUUID(),
        sq.key,
        sq.name,
        sq.description,
        stepsJson,
        paramsJson,
        ont.key,
        embedding,
      );
    }

    createdOntologies.push(toOntologyResponse(ontData));
  }

  // The shared saved-query index is ensured once at the end.
  if (provider) {
    await store.ensureSavedQueryVectorIndex(provider.dimensions);
  }

  invalidateLoadedSchemaCache();
  return { ontologies: createdOntologies };
}

// --- AI Agent Config ---

const AGENT_KEY_REGEX = new RegExp(AGENT_KEY_PATTERN);

/** Render a list the way error messages spell one: `['a', 'b']`. */
function pyList(items: string[]): string {
  return `[${items.map((item) => `'${item}'`).join(", ")}]`;
}

async function resolveOntologyByKey(store: ModelingStore, ontologyKey: string): Promise<Row> {
  const ont = await store.getOntologyByKey(ontologyKey);
  if (!ont) {
    throw new NotFoundError(`Ontology '${ontologyKey}' not found`);
  }
  return ont;
}

function toAiAgentResponse(data: Row): AiAgentConfigResponseBody {
  return {
    key: data.key as string,
    name: data.name as string,
    description: optString(data.description),
    systemPrompt: optString(data.systemPrompt),
    tools: (data.tools as string[] | null | undefined) ?? null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

export async function listAiAgents(
  ontologyKey: string,
  store: ModelingStore,
): Promise<AiAgentConfigResponseBody[]> {
  const ont = await resolveOntologyByKey(store, ontologyKey);
  const rows = await store.listAiAgents(ont.ontologyId as string);
  return rows.map(toAiAgentResponse);
}

/** Upsert by key. Returns `[response, created]`. */
export async function upsertAiAgent(
  ontologyKey: string,
  agentKey: string,
  body: AiAgentConfigUpsertInput,
  store: ModelingStore,
): Promise<[AiAgentConfigResponseBody, boolean]> {
  if (!AGENT_KEY_REGEX.test(agentKey)) {
    throw new ValidationError(
      `Invalid agent key '${agentKey}'. Must match pattern: ${AGENT_KEY_PATTERN}`,
    );
  }
  if (agentKey.length > MAX_KEY_LENGTH) {
    throw new ValidationError(
      `Invalid agent key '${agentKey}'. Maximum length is ${MAX_KEY_LENGTH} characters`,
    );
  }
  if (agentKey === "_default") {
    throw new ValidationError("Agent key '_default' is reserved");
  }

  // The allowlist is validated against the fixed grantable set: an unknown
  // name is rejected and the error names the valid set.
  const tools = body.tools ?? null;
  if (tools !== null) {
    const unknown = tools.filter((t) => !VALID_AGENT_TOOLS.has(t));
    if (unknown.length > 0) {
      const available = [...VALID_AGENT_TOOLS].sort();
      throw new ValidationError(
        `Unknown tool(s): ${pyList(unknown)}. Available tools: ${pyList(available)}`,
      );
    }
  }

  const ont = await resolveOntologyByKey(store, ontologyKey);
  const agentConfigId = randomUUID();
  const [data, created] = await store.upsertAiAgent(
    ont.ontologyId as string,
    agentConfigId,
    agentKey,
    body.name,
    body.description ?? null,
    body.systemPrompt ?? null,
    tools,
  );
  invalidateLoadedSchemaCache();
  return [toAiAgentResponse(data), created];
}

export async function deleteAiAgent(
  ontologyKey: string,
  agentKey: string,
  store: ModelingStore,
): Promise<void> {
  const ont = await resolveOntologyByKey(store, ontologyKey);
  const deleted = await store.deleteAiAgent(ont.ontologyId as string, agentKey);
  if (!deleted) {
    throw new NotFoundError(`AI agent '${agentKey}' not found`);
  }
  invalidateLoadedSchemaCache();
}

// --- Saved Query Config ---

const BINDING_PATTERN = /^\{\{(\w+)\.(\w+)\}\}$/;
const PARAM_REF_PATTERN = /\$([a-zA-Z_]\w*)/g;

function toStepResponse(s: Row): StepResponseBody {
  return {
    name: s.name as string,
    type: s.type as string,
    oql: (s.oql as string | undefined) ?? null,
    entityTypeKey: (s.entityTypeKey as string | undefined) ?? null,
    query: (s.query as string | undefined) ?? null,
    limit: (s.limit as number | undefined) ?? null,
    minScore: (s.minScore as number | undefined) ?? null,
    bindings: (s.bindings as Record<string, string> | undefined) ?? null,
  };
}

/** Convert a store row to the response shape, deserializing the JSON text
 * the store holds uninterpreted. */
function toSavedQueryResponse(data: Row): SavedQueryResponseBody {
  const paramsRaw = data.parameters ?? "[]";
  const paramsList = (
    typeof paramsRaw === "string" ? JSON.parse(paramsRaw) : (paramsRaw ?? [])
  ) as Row[];
  const stepsRaw = data.steps ?? "[]";
  const stepsList = (
    typeof stepsRaw === "string" ? JSON.parse(stepsRaw) : (stepsRaw ?? [])
  ) as Row[];
  return {
    key: data.key as string,
    name: data.name as string,
    description: data.description as string,
    steps: stepsList.map(toStepResponse),
    parameters: paramsList.map((p) => ({
      name: p.name as string,
      description: p.description as string,
      dataType: p.dataType as never,
    })),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

/**
 * Definition-time pipeline validation. Structural and cross-check failures
 * are COLLECTED and reported together (`docs/capabilities/saved-queries.md`).
 */
function validatePipeline(steps: StepInput[], paramNames: string[], queryKey: string): void {
  const errors: string[] = [];
  const declaredParams = new Set(paramNames);
  const seenStepNames = new Map<string, number>();

  steps.forEach((step, i) => {
    const prefix = `steps[${i}]`;

    // Step name uniqueness.
    if (seenStepNames.has(step.name)) {
      errors.push(
        `${prefix}.name: '${step.name}' already used by steps[${seenStepNames.get(step.name)}]`,
      );
    }
    seenStepNames.set(step.name, i);

    // Type-specific required fields.
    if (step.type === "oql") {
      if (!step.oql) {
        errors.push(`${prefix}.oql: Required for oql steps`);
      }
    } else if (step.type === "semantic_search") {
      if (!step.entityTypeKey) {
        errors.push(`${prefix}.entityTypeKey: Required for semantic_search steps`);
      }
      if (!step.query) {
        errors.push(`${prefix}.query: Required for semantic_search steps`);
      }
    }

    // Bindings must match the reference form exactly and reference a step
    // declared STRICTLY earlier — self and forward references are rejected.
    if (step.bindings) {
      for (const [paramName, expr] of Object.entries(step.bindings)) {
        const match = BINDING_PATTERN.exec(expr);
        if (!match) {
          errors.push(
            `${prefix}.bindings.${paramName}: Invalid expression '${expr}'. ` +
              "Must be {{stepName.fieldName}}",
          );
          continue;
        }
        const refStep = match[1]!;
        if (!seenStepNames.has(refStep) || seenStepNames.get(refStep)! >= i) {
          errors.push(
            `${prefix}.bindings.${paramName}: References step '${refStep}' ` +
              "which does not exist before this step",
          );
        }
      }
    }
  });

  // Cross-check parameters against $param references across all oql steps.
  const allQueryParams = new Set<string>();
  const allBindingNames = new Set<string>();
  for (const step of steps) {
    if (step.bindings) {
      for (const name of Object.keys(step.bindings)) {
        allBindingNames.add(name);
      }
    }
    if (step.type === "oql" && step.oql) {
      for (const m of step.oql.matchAll(PARAM_REF_PATTERN)) {
        allQueryParams.add(m[1]!);
      }
    }
  }

  // Params needed from the caller = all $refs minus those a binding supplies.
  const neededFromUser = new Set([...allQueryParams].filter((p) => !allBindingNames.has(p)));
  // $param refs in semantic_search query fields are always caller-supplied.
  for (const step of steps) {
    if (step.type === "semantic_search" && step.query) {
      for (const m of step.query.matchAll(PARAM_REF_PATTERN)) {
        neededFromUser.add(m[1]!);
      }
    }
  }

  const referencedNotDeclared = [...neededFromUser].filter((p) => !declaredParams.has(p)).sort();
  const declaredNotUsed = [...declaredParams].filter((p) => !neededFromUser.has(p)).sort();
  if (referencedNotDeclared.length > 0) {
    errors.push(
      `Parameters referenced in steps but not declared: ${pyList(referencedNotDeclared)}`,
    );
  }
  if (declaredNotUsed.length > 0) {
    errors.push(
      `Parameters declared but not referenced in any step: ${pyList(declaredNotUsed)}`,
    );
  }

  if (errors.length > 0) {
    throw new ValidationError(`Saved query '${queryKey}' validation failed`, { errors });
  }
}

export async function listSavedQueries(
  ontologyKey: string,
  store: ModelingStore,
): Promise<SavedQueryResponseBody[]> {
  const ont = await resolveOntologyByKey(store, ontologyKey);
  const rows = await store.listSavedQueries(ont.ontologyId as string);
  return rows.map(toSavedQueryResponse);
}

/** Upsert by key. Returns `[response, created]`. */
export async function upsertSavedQuery(
  ontologyKey: string,
  queryKey: string,
  body: SavedQueryUpsertInput,
  store: ModelingStore,
  runtimeStore: RuntimeStore,
): Promise<[SavedQueryResponseBody, boolean]> {
  if (!AGENT_KEY_REGEX.test(queryKey)) {
    throw new ValidationError(
      `Invalid query key '${queryKey}'. Must match pattern: ${AGENT_KEY_PATTERN}`,
    );
  }
  if (queryKey.length > MAX_KEY_LENGTH) {
    throw new ValidationError(
      `Invalid query key '${queryKey}'. Maximum length is ${MAX_KEY_LENGTH} characters`,
    );
  }

  // Parameters are scalars: any data type except document.
  for (const p of body.parameters) {
    if (p.dataType === "document") {
      throw new ValidationError(
        `Saved query parameter '${p.name}' has data type 'document'; ` +
          "parameters must be scalar types",
      );
    }
  }

  // Validate pipeline structure and parameter cross-checks (collect-all).
  validatePipeline(
    body.steps,
    body.parameters.map((p) => p.name),
    queryKey,
  );

  const ont = await resolveOntologyByKey(store, ontologyKey);

  // Validate each oql step against the lens's schema — skipped ONLY when
  // that schema cannot be loaded (the run-time check still applies then).
  try {
    const loaded = await loadSchema(ontologyKey, runtimeStore);
    for (const step of body.steps) {
      if (step.type === "oql" && step.oql) {
        parseAndValidate(step.oql, loaded.scoped);
      }
    }
  } catch (exc) {
    if (exc instanceof NotFoundError) {
      // Ontology has no runtime schema loaded yet.
    } else if (exc instanceof ValidationError || exc instanceof StoreError) {
      // A storage failure loading the schema is not a problem with the
      // submitted query; a validation failure IS one — both pass through.
      throw exc;
    } else {
      throw new ValidationError(
        `Query validation failed: ${exc instanceof Error ? exc.message : String(exc)}`,
      );
    }
  }

  const stepsJson = JSON.stringify(
    body.steps.map((s) => ({
      name: s.name,
      type: s.type,
      ...(s.oql ? { oql: s.oql } : {}),
      ...(s.entityTypeKey ? { entityTypeKey: s.entityTypeKey } : {}),
      ...(s.query ? { query: s.query } : {}),
      ...(s.limit !== null && s.limit !== undefined ? { limit: s.limit } : {}),
      ...(s.minScore !== null && s.minScore !== undefined ? { minScore: s.minScore } : {}),
      ...(s.bindings && Object.keys(s.bindings).length > 0 ? { bindings: s.bindings } : {}),
    })),
  );
  const paramsJson = JSON.stringify(
    body.parameters.map((p) => ({
      name: p.name,
      description: p.description,
      dataType: p.dataType,
    })),
  );

  // Embed the description for semantic discovery over saved queries.
  let embedding: number[] | null = null;
  const provider = getEmbeddingProvider();
  if (provider) {
    embedding = await provider.embed(body.description);
  }

  const savedQueryId = randomUUID();
  const [data, created] = await store.upsertSavedQuery(
    ont.ontologyId as string,
    savedQueryId,
    queryKey,
    body.name,
    body.description,
    stepsJson,
    paramsJson,
    ontologyKey,
    embedding,
  );
  invalidateLoadedSchemaCache();
  return [toSavedQueryResponse(data), created];
}

export async function deleteSavedQuery(
  ontologyKey: string,
  queryKey: string,
  store: ModelingStore,
): Promise<void> {
  const ont = await resolveOntologyByKey(store, ontologyKey);
  const deleted = await store.deleteSavedQuery(ont.ontologyId as string, queryKey);
  if (!deleted) {
    throw new NotFoundError(`Saved query '${queryKey}' not found`);
  }
  invalidateLoadedSchemaCache();
}
