/**
 * Modeling service: every domain rule for one ontology's schema — entity
 * types, relation types, property definitions. REST and MCP are two
 * entrances to these same functions, so no rule may live in a router.
 *
 * Every mutating path is one design change (`ModelingStore.changeDesign`):
 * its reads, checks and writes run in one transaction that holds the
 * design exclusively and advances its revision, so it applies whole or
 * not at all, and every server process sees it by the revision. Work that
 * needs a provider (embeddings) runs before it; generation work after its
 * commit, as best effort (`afterCommit`). Schema changes also keep the managed search indices in step —
 * their definitions inside the change (`syncManagedDefinitions`), their
 * generations after it (`afterSchemaChange`); a schema removal that
 * reaches a custom search index follows the cascade protocol
 * (`searchIndices.ts`).
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { AccessActor } from "../access/store.js";
import { getEmbeddingProvider } from "../core/embedding.js";
import {
  CascadeRequiredError,
  ConflictError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "../core/exceptions.js";
import { RETRIEVER_CONFIG_VERSION, RetrieverConfig } from "../core/retriever.js";
import { parseAndValidate } from "../core/oql/index.js";
import type { ModelingStore, ParentViolation, RuntimeStore } from "../core/ports.js";
import {
  DATA_TYPES,
  LENS_RESOURCE_KEY_PATTERN,
  MAX_KEY_LENGTH,
  NAME_PROPERTY_DATA_TYPE,
  namePropertyDisplayName,
  SCHEMA_KEY_PATTERN,
  type NewPropertyDef,
  type ParentEnd,
  type TypeKind,
} from "../core/schemas.js";
import { NAVIGATOR_CONFIG_VERSION, NavigatorConfig } from "../runtime/assistants/navigators/config.js";
import { lensChangesetCount } from "../runtime/changesets.js";
import {
  buildIdentity,
  IDENTITY_DATA_TYPES,
  IDENTITY_TOO_LONG,
  MAX_IDENTITY_PROPERTIES,
} from "../runtime/identity.js";
import { afterCommit, reconcileSearchGenerations } from "../runtime/indexing/generations.js";
import { afterDesignChange, syncManagedDefinitions } from "../runtime/indexing/managed.js";
import {
  applyIndexCascade,
  exportSearchIndices,
  importedInclusionErrors,
  importedIndexConflicts,
  importedIndexErrors,
  importLensIndexInclusions,
  importSearchIndices,
  indexCascadeText,
  lensIndexWarnings,
  planIndexCascade,
  requireSearchIndices,
} from "./searchIndices.js";
import { portableNavigator } from "./navigators.js";
import { portable as portableRetriever } from "./retrievers.js";
import { readSearchSettings, updateSearchSettings as changeSearchSettings } from "../runtime/indexing/settings.js";
import { loadSchema, loadSchemaUncached, buildSchemaCacheFromRaw, applyScopeFiltering } from "../runtime/schemaCache.js";
import { VALID_AGENT_TOOLS } from "../runtime/toolNames.js";
import {
  ExportPayload,
  StepSchema as StepZodSchema,
  TRANSFER_FORMAT_VERSION,
} from "./schemas.js";
import { readFields, retrieverWarningKey } from "./transfer/upgrader.js";
import { upgradeToCurrent } from "./transfer/upgrades.js";
import type {
  ExportLensInput,
  SearchSettingsResponseBody,
  SearchSettingsUpdateInput,
  AgentConfigResponseBody,
  AgentConfigUpsertInput,
  EntityTypeCreateInput,
  EntityTypeResponseBody,
  EntityTypeUpdateInput,
  IncludeTypeRequestInput,
  IncludeTypeResponseBody,
  IncludeTypeUpdateInput,
  LensCreateInput,
  LensResponseBody,
  LensUpdateInput,
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
    nameProperty: data.nameProperty as string,
    identityProperties: (data.identityProperties as string[] | null | undefined) ?? null,
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
    parent: (data.parent as ParentEnd | null | undefined) ?? null,
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

function toLensResponse(data: Row): LensResponseBody {
  return {
    lensId: data.lensId as string,
    key: data.key as string,
    name: data.name as string,
    description: optString(data.description),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

/**
 * After a committed schema change whose design change synced the managed
 * search indices (`syncManagedDefinitions`): reconcile their generations
 * and refresh the indices that read a type in `refreshTypes` (a display
 * name or the name property changed).
 */
async function afterSchemaChange(store: ModelingStore, refreshTypes: string[] = []): Promise<void> {
  const indices = store.searchIndices();
  await afterCommit(indices.ontologyKey, () => afterDesignChange(indices, refreshTypes));
}

// --- Lens ---

export async function createLens(
  body: LensCreateInput,
  store: ModelingStore,
): Promise<LensResponseBody> {
  const data = await store.changeDesign(async (s) => {
    const existingKey = await s.getLensByKey(body.key);
    if (existingKey) {
      throw new ConflictError(`Lens with key '${body.key}' already exists`);
    }
    const existing = await s.getLensByName(body.name);
    if (existing) {
      throw new ConflictError(`Lens with name '${body.name}' already exists`);
    }
    const lensId = randomUUID();
    return s.createLens(lensId, body.key, body.name, body.description ?? null);
  });
  return toLensResponse(data);
}

export async function listLenses(store: ModelingStore): Promise<LensResponseBody[]> {
  const rows = await store.listLenses();
  return rows.map(toLensResponse);
}

export async function getLens(
  lensId: string,
  store: ModelingStore,
): Promise<LensResponseBody> {
  const data = await store.getLens(lensId);
  if (!data) {
    throw new NotFoundError(`Lens '${lensId}' not found`);
  }
  return toLensResponse(data);
}

export async function updateLens(
  lensId: string,
  body: LensUpdateInput,
  store: ModelingStore,
): Promise<LensResponseBody> {
  const data = await store.changeDesign(async (s) => {
    if (body.name !== null && body.name !== undefined) {
      const existing = await s.getLensByName(body.name);
      if (existing && existing.lensId !== lensId) {
        throw new ConflictError(`Lens with name '${body.name}' already exists`);
      }
    }
    const data = await s.updateLens(lensId, body.name ?? null, body.description ?? null);
    if (!data) {
      throw new NotFoundError(`Lens '${lensId}' not found`);
    }
    return data;
  });
  return toLensResponse(data);
}

/**
 * Lens deletion is always permitted: it cascades to nothing but the lens's
 * own agent configurations, saved queries and changesets (handled in the
 * store), needs no consent, and leaves the schema and every instance
 * untouched. It reports how many changesets went with it (V42), counted
 * before the delete. With authentication on (`actor`), the lens's role
 * assignments go too, best effort: a leftover reveals nothing
 * (`access/authorize.ts`).
 */
export async function deleteLens(
  lensId: string,
  store: ModelingStore,
  runtime: RuntimeStore,
  actor: AccessActor | null = null,
): Promise<{ changesetsDeleted: number }> {
  const changesetsDeleted = await lensChangesetCount(lensId, runtime);
  await store.changeDesign(async (s) => {
    if (!(await s.deleteLens(lensId))) {
      throw new NotFoundError(`Lens '${lensId}' not found`);
    }
  });
  await actor?.store.forgetLens(lensId, actor.principalId).catch((error: unknown) => {
    console.error(`Removing the assignments of deleted lens '${lensId}' failed:`, error);
  });
  return { changesetsDeleted };
}

// --- Entity Type (Global) ---

export async function createEntityType(
  body: EntityTypeCreateInput,
  store: ModelingStore,
  cascade = false,
): Promise<EntityTypeResponseBody> {
  const data = await store.changeDesign(async (s) => {
    const existing = await s.getEntityTypeByKey(body.key);
    if (existing) {
      throw new ConflictError(`Entity type with key '${body.key}' already exists`);
    }
    const entityTypeId = randomUUID();
    let data = await s.createEntityType(
      entityTypeId,
      body.key,
      body.displayName,
      body.description ?? null,
      newNameProperty(body.nameProperty),
    );
    const identityProperties = body.identityProperties ?? null;
    if (identityProperties !== null) {
      data = await setIdentity(s, data, identityProperties, cascade);
    }
    await syncManagedDefinitions(s.searchIndices());
    return data;
  });
  await afterSchemaChange(store);
  return toEntityTypeResponse(data);
}

/** The name property an entity type is created with when nothing else
 * defines it: a non-required string property under `key`. */
function newNameProperty(key: string): NewPropertyDef {
  return {
    propertyId: randomUUID(),
    key,
    displayName: namePropertyDisplayName(key),
    description: null,
    dataType: NAME_PROPERTY_DATA_TYPE,
    required: false,
    defaultValue: null,
  };
}

/** The 422 for a name property that is not a `string` property of the type. */
function notANameProperty(key: string, entityTypeKey: string): ValidationError {
  const message =
    `Property '${key}' is not a ${NAME_PROPERTY_DATA_TYPE} property of entity type ` +
    `'${entityTypeKey}'; the name property must be one`;
  return new ValidationError(message, { fields: { nameProperty: message } });
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
  cascade = false,
): Promise<EntityTypeResponseBody> {
  const nameProperty = body.nameProperty ?? null;
  const { before, data } = await store.changeDesign(async (s) => {
    const before = await s.getEntityType(entityTypeId);
    if (nameProperty !== null) {
      const et = before;
      if (!et) {
        throw new NotFoundError(`Entity type '${entityTypeId}' not found`);
      }
      const prop = await s.getPropertyByKey(entityTypeId, "EntityType", nameProperty);
      if (!prop || prop.dataType !== NAME_PROPERTY_DATA_TYPE) {
        throw notANameProperty(nameProperty, et.key as string);
      }
    }
    let data = await s.updateEntityType(
      entityTypeId,
      body.displayName ?? null,
      body.description ?? null,
      nameProperty,
    );
    if (!data) {
      throw new NotFoundError(`Entity type '${entityTypeId}' not found`);
    }
    // Omitted leaves the identity unchanged; an explicit null clears it.
    if (body.identityProperties !== undefined) {
      data = await setIdentity(s, data, body.identityProperties, cascade);
    }
    await syncManagedDefinitions(s.searchIndices());
    return { before, data };
  });
  const rendered =
    before !== null &&
    (before.displayName !== data.displayName || before.nameProperty !== data.nameProperty);
  await afterSchemaChange(store, rendered ? [data.key as string] : []);
  return toEntityTypeResponse(data);
}

// --- Entity identity ---

/** The 422 for an identity list that cannot be one. */
function badIdentity(message: string): ValidationError {
  return new ValidationError(message, { fields: { identityProperties: message } });
}

/** The keys of an entity type's identity, or null. */
function identityOf(et: Row): string[] | null {
  return (et.identityProperties as string[] | null | undefined) ?? null;
}

/**
 * The refusal when the type's stored entities cannot take the identity:
 * an entity without a value (or an empty one) for a listed property, two
 * entities with one identity, an identity over the length limit. As a
 * refused parent flag, `details.violations` names each kind with its
 * count and its first five entities by id; nothing is written.
 */
function identityDataConflicts(
  entityTypeKey: string,
  violations: { rule: string; ids: string[] }[],
): ConflictError {
  const found = violations.filter((violation) => violation.ids.length > 0);
  const counts = found.map((v) => `${v.rule}: ${v.ids.length}`).join(", ");
  return new ConflictError(
    `The stored entities of entity type '${entityTypeKey}' cannot take this identity (${counts})`,
    {
      violations: found.map((v) => ({
        rule: v.rule,
        count: v.ids.length,
        entities: [...v.ids].sort().slice(0, 5).map((id) => ({ type: entityTypeKey, id })),
      })),
    },
  );
}

/**
 * Set, change or clear an entity type's identity inside the caller's
 * design change, and rebuild the derived identity of every entity of the
 * type (`docs/capabilities/entity-identity.md#declaring-an-identity`):
 *
 * 1. the list itself — 1 to 5 distinct keys of the type's own `string`,
 *    `integer` or `date` properties — or a 422 on `identityProperties`;
 * 2. the stored entities — a value for every listed property, no empty
 *    string, unique and short enough identities — or a 409 naming them;
 * 3. the cascade protocol: a listed property that is optional or has a
 *    default, or that a lens allowlist for the type omits, needs consent;
 *    with it the properties become required, lose their defaults and join
 *    every allowlist for the type.
 *
 * Clearing is always allowed. Repeating the stored list changes nothing.
 * Returns the type row as written.
 */
async function setIdentity(
  s: ModelingStore,
  et: Row,
  requested: string[] | null,
  cascade: boolean,
): Promise<Row> {
  const entityTypeId = et.entityTypeId as string;
  const entityTypeKey = et.key as string;
  const current = identityOf(et);
  if (JSON.stringify(current) === JSON.stringify(requested)) return et;
  if (requested === null) {
    const written = await s.setEntityTypeIdentity(entityTypeId, null);
    await s.writeEntityIdentities(entityTypeKey, null);
    return written ?? et;
  }

  if (requested.length === 0 || requested.length > MAX_IDENTITY_PROPERTIES) {
    throw badIdentity(`An identity has 1 to ${MAX_IDENTITY_PROPERTIES} properties`);
  }
  const duplicate = requested.find((key, index) => requested.indexOf(key) !== index);
  if (duplicate !== undefined) {
    throw badIdentity(`Property '${duplicate}' is listed twice in the identity`);
  }
  const properties = await s.listProperties(entityTypeId, "EntityType");
  const byKey = new Map(properties.map((prop) => [prop.key as string, prop]));
  for (const key of requested) {
    const prop = byKey.get(key);
    if (prop === undefined) {
      throw badIdentity(`Property '${key}' not found on entity type '${entityTypeKey}'`);
    }
    if (!IDENTITY_DATA_TYPES.includes(prop.dataType as string)) {
      throw badIdentity(
        `Property '${key}' is a ${prop.dataType as string} property; an identity property is ` +
          `${IDENTITY_DATA_TYPES.join(", ")}`,
      );
    }
  }

  // The stored entities, before any consent: no repair can mend them.
  const identityProperties = requested.map((key) => ({ key, dataType: byKey.get(key)!.dataType as string }));
  const missing: string[] = [];
  const tooLong: string[] = [];
  const holders = new Map<string, string[]>();
  const built: { id: string; identity: string }[] = [];
  for (const { id, values } of await s.readEntityValues(entityTypeKey, requested)) {
    const result = buildIdentity(identityProperties, values);
    if (result.faults !== null) {
      const tooLongFault = Object.values(result.faults).includes(IDENTITY_TOO_LONG);
      (tooLongFault ? tooLong : missing).push(id);
      continue;
    }
    built.push({ id, identity: result.identity });
    holders.set(result.identity, [...(holders.get(result.identity) ?? []), id]);
  }
  const duplicates = [...holders.values()].filter((ids) => ids.length > 1).flat();
  if (missing.length + duplicates.length + tooLong.length > 0) {
    throw identityDataConflicts(entityTypeKey, [
      { rule: "missing_value", ids: missing },
      { rule: "duplicate", ids: duplicates },
      { rule: "too_long", ids: tooLong },
    ]);
  }

  // The cascade protocol: the stored flags and every allowlist must hold
  // the whole identity.
  const unflagged = requested.filter((key) => {
    const prop = byKey.get(key)!;
    return prop.required !== true || (prop.defaultValue !== null && prop.defaultValue !== undefined);
  });
  const omitting = new Map<string, string[]>();
  for (const key of requested) {
    const lenses = await s.findLensesWithExplicitProperty("EntityType", entityTypeId, key);
    if (lenses.length > 0) omitting.set(key, lenses);
  }
  const affectedLenses = [...new Set([...omitting.values()].flat())].sort();
  if ((unflagged.length > 0 || affectedLenses.length > 0) && !cascade) {
    const reasons = [
      ...(unflagged.length > 0 ? [`${unflagged.map((k) => `'${k}'`).join(", ")} must become required without a default`] : []),
      ...(affectedLenses.length > 0 ? [`${affectedLenses.length} lens(es) must show every identity property`] : []),
    ];
    throw new CascadeRequiredError(
      `Setting the identity of entity type '${entityTypeKey}': ${reasons.join("; ")}. ` +
        "Use ?cascade=true to apply.",
      affectedLenses,
    );
  }
  for (const key of unflagged) {
    await s.updateProperty(entityTypeId, "EntityType", byKey.get(key)!.propertyId as string, null, null, true, null, true);
  }
  for (const key of omitting.keys()) {
    await s.addPropertyToIncludesLists("EntityType", entityTypeId, key);
  }

  const written = await s.setEntityTypeIdentity(entityTypeId, requested);
  await s.writeEntityIdentities(entityTypeKey, built);
  return written ?? et;
}

/** The 409 for a change an identity property refuses while it is one. */
function identityLocked(propertyKey: string, entityTypeKey: string, change: string): ConflictError {
  return new ConflictError(
    `Property '${propertyKey}' is part of the identity of entity type '${entityTypeKey}' and ` +
      `cannot ${change}. Change the identity first.`,
  );
}

export async function deleteEntityType(
  entityTypeId: string,
  cascade: boolean,
  store: ModelingStore,
): Promise<void> {
  // The whole cascade is one design change: nothing of it remains when a
  // step fails.
  await store.changeDesign(async (s) => {
    // Referenced by a relation type: unconditional conflict — cascade never
    // overrides it, there is no consenting to it.
    const referenced = await s.isEntityTypeReferenced(entityTypeId);
    if (referenced) {
      throw new ConflictError(
        `Entity type '${entityTypeId}' is referenced by one or more relation types`,
      );
    }
    const etData = await s.getEntityType(entityTypeId);

    // Included by scoped lenses or read by custom search indices: the
    // cascade protocol. Indices rooted on the type go (and with them their
    // lens inclusions); groups and target entries naming it are removed.
    const affected = await s.findLensesIncludingType("EntityType", entityTypeId);
    const indexPlan = await planIndexCascade(s, {
      kind: "entityType",
      key: (etData?.key as string | undefined) ?? "",
    });
    if ((affected.length > 0 || indexPlan.affectedIndices.length > 0) && !cascade) {
      throw new CascadeRequiredError(
        `Entity type is included by ${affected.length} lens(es)${indexCascadeText(indexPlan)}. ` +
          "Use ?cascade=true to remove.",
        [...new Set([...affected, ...indexPlan.affectedLenses])].sort(),
        indexPlan.affectedIndices,
      );
    }
    if (affected.length > 0) {
      await s.removeAllIncludesForType("EntityType", entityTypeId);
    }
    await applyIndexCascade(s, indexPlan);

    const deleted = await s.deleteEntityType(entityTypeId);
    if (!deleted) {
      throw new NotFoundError(`Entity type '${entityTypeId}' not found`);
    }
    await syncManagedDefinitions(s.searchIndices());
  });
  await afterSchemaChange(store);
}

// --- Relation Type (Global) ---

/** The 409 a parent flag write refuses with (A2): the stored relations
 * break the parent rules under the new reading. `details.violations`
 * carries each broken rule's count and first entities; the message
 * carries the counts. */
function parentRulesBroken(subject: string, violations: ParentViolation[]): ConflictError {
  const counts = violations.map((v) => `${v.rule}: ${v.count}`).join(", ");
  return new ConflictError(
    `${subject}: the stored relations break the parent rules (${counts})`,
    { violations },
  );
}

export async function createRelationType(
  body: RelationTypeCreateInput,
  store: ModelingStore,
): Promise<RelationTypeResponseBody> {
  const row = await store.changeDesign(async (s) => {
    const existing = await s.getRelationTypeByKey(body.key);
    if (existing) {
      throw new ConflictError(`Relation type with key '${body.key}' already exists`);
    }
    // Endpoints must exist at creation, and are immutable forever after.
    const source = await s.getEntityTypeByKey(body.sourceEntityTypeKey);
    if (!source) {
      throw new ValidationError(`Source entity type '${body.sourceEntityTypeKey}' not found`);
    }
    const target = await s.getEntityTypeByKey(body.targetEntityTypeKey);
    if (!target) {
      throw new ValidationError(`Target entity type '${body.targetEntityTypeKey}' not found`);
    }
    const relationTypeId = randomUUID();
    const written = await s.createRelationType(
      relationTypeId,
      body.key,
      body.displayName,
      body.description ?? null,
      body.sourceEntityTypeKey,
      body.targetEntityTypeKey,
      body.parent ?? null,
    );
    if ("violations" in written) {
      throw parentRulesBroken(
        `Relation type '${body.key}' cannot be created with parent end '${body.parent}'`,
        written.violations,
      );
    }
    return written.row;
  });
  return toRelationTypeResponse(row);
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
  const { before, data } = await store.changeDesign(async (s) => {
    const before = await s.getRelationType(relationTypeId);
    if (!before) {
      throw new NotFoundError(`Relation type '${relationTypeId}' not found`);
    }
    // An explicitly null parent clears it, as a property's default; omitted
    // (`undefined`) means unchanged. A refused flag leaves the whole update
    // unwritten.
    if (body.parent !== undefined && body.parent !== before.parent) {
      const written = await s.setRelationTypeParent(relationTypeId, body.parent);
      if (written === null) {
        throw new NotFoundError(`Relation type '${relationTypeId}' not found`);
      }
      if ("violations" in written) {
        throw parentRulesBroken(
          `Relation type '${before.key as string}' cannot take parent end '${body.parent}'`,
          written.violations,
        );
      }
    }
    const data = await s.updateRelationType(
      relationTypeId,
      body.displayName ?? null,
      body.description ?? null,
    );
    if (!data) {
      throw new NotFoundError(`Relation type '${relationTypeId}' not found`);
    }
    return { before, data };
  });
  if (before.displayName !== data.displayName) {
    await afterSchemaChange(store, [data.key as string]);
  }
  return toRelationTypeResponse(data);
}

export async function deleteRelationType(
  relationTypeId: string,
  cascade: boolean,
  store: ModelingStore,
): Promise<void> {
  // The whole cascade is one design change.
  const indicesChanged = await store.changeDesign(async (s) => {
    // Included by scoped lenses or grouped by custom search indices: the
    // cascade protocol. The groups on it are removed.
    const rtData = await s.getRelationType(relationTypeId);
    const affected = await s.findLensesIncludingType("RelationType", relationTypeId);
    const indexPlan = await planIndexCascade(s, {
      kind: "relationType",
      key: (rtData?.key as string | undefined) ?? "",
    });
    if ((affected.length > 0 || indexPlan.affectedIndices.length > 0) && !cascade) {
      throw new CascadeRequiredError(
        `Relation type is included by ${affected.length} lens(es)${indexCascadeText(indexPlan)}. ` +
          "Use ?cascade=true to remove.",
        [...new Set([...affected, ...indexPlan.affectedLenses])].sort(),
        indexPlan.affectedIndices,
      );
    }
    if (affected.length > 0) {
      await s.removeAllIncludesForType("RelationType", relationTypeId);
    }
    await applyIndexCascade(s, indexPlan);
    const deleted = await s.deleteRelationType(relationTypeId);
    if (!deleted) {
      throw new NotFoundError(`Relation type '${relationTypeId}' not found`);
    }
    if (indexPlan.affectedIndices.length === 0) return false;
    await syncManagedDefinitions(s.searchIndices());
    return true;
  });
  if (indicesChanged) {
    await afterSchemaChange(store);
  }
}

// --- Property Definition ---

/** The owning type's row; not-found when it does not exist. */
async function ensureOwnerExists(
  store: ModelingStore,
  ownerId: string,
  typeKind: TypeKind,
): Promise<Row> {
  if (typeKind === "EntityType") {
    const data = await store.getEntityType(ownerId);
    if (!data) {
      throw new NotFoundError(`Entity type '${ownerId}' not found`);
    }
    return data;
  }
  const data = await store.getRelationType(ownerId);
  if (!data) {
    throw new NotFoundError(`Relation type '${ownerId}' not found`);
  }
  return data;
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
  const data = await store.changeDesign(async (s) => {
    await ensureOwnerExists(s, ownerId, typeKind);
    const existing = await s.getPropertyByKey(ownerId, typeKind, body.key);
    if (existing) {
      throw new ConflictError(`Property with key '${body.key}' already exists on this type`);
    }
    // Cascade check: adding a required property without a default breaks
    // every lens whose explicit allowlist for this type omits the new key.
    if (body.required && (body.defaultValue === null || body.defaultValue === undefined)) {
      const affected = await s.findLensesWithExplicitProperty(
        typeKind,
        ownerId,
        body.key,
      );
      if (affected.length > 0 && !cascade) {
        throw new CascadeRequiredError(
          `Adding required property '${body.key}' without default would break ` +
            `${affected.length} lens(es). ` +
            "Use ?cascade=true to auto-add to explicit property lists.",
          affected,
        );
      }
      if (affected.length > 0) {
        await s.addPropertyToIncludesLists(typeKind, ownerId, body.key);
      }
    }
    const propertyId = randomUUID();
    const data = await s.createProperty(
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
    if (typeKind === "EntityType") {
      await syncManagedDefinitions(s.searchIndices());
    }
    return data;
  });
  if (typeKind === "EntityType") {
    await afterSchemaChange(store);
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
  const { owner, renamed, data } = await store.changeDesign(async (s) => {
    const owner = await ensureOwnerExists(s, ownerId, typeKind);
    const before = await s.getProperty(ownerId, typeKind, propertyId);
    // An identity property stays required without a default.
    if (typeKind === "EntityType" && before !== null && identityOf(owner)?.includes(before.key as string)) {
      if (body.required === false) {
        throw identityLocked(before.key as string, owner.key as string, "become optional");
      }
      if (body.defaultValue !== null && body.defaultValue !== undefined) {
        throw identityLocked(before.key as string, owner.key as string, "take a default");
      }
    }
    // An explicitly null defaultValue clears the default — the one exception
    // to sparse-update semantics. Omitted (`undefined`) means unchanged.
    const clearDefault = body.defaultValue === null;
    const data = await s.updateProperty(
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
    const renamed = before !== null && before.displayName !== data.displayName;
    if (typeKind === "EntityType" || renamed) {
      await syncManagedDefinitions(s.searchIndices());
    }
    return { owner, renamed, data };
  });
  if (typeKind === "EntityType" || renamed) {
    await afterSchemaChange(store, renamed ? [owner.key as string] : []);
  }
  return toPropertyResponse(data);
}

export async function deleteProperty(
  ownerId: string,
  typeKind: TypeKind,
  propertyId: string,
  cascade: boolean,
  store: ModelingStore,
): Promise<void> {
  // The whole cascade is one design change.
  const indicesChanged = await store.changeDesign(async (s) => {
    const owner = await ensureOwnerExists(s, ownerId, typeKind);
    const prop = await s.getProperty(ownerId, typeKind, propertyId);
    if (!prop) {
      throw new NotFoundError(`Property '${propertyId}' not found on this type`);
    }
    // No cascade: the name property is reassigned deliberately, never
    // picked by the server.
    if (typeKind === "EntityType" && owner.nameProperty === prop.key) {
      throw new ConflictError(
        `Property '${prop.key as string}' is the name property of entity type ` +
          `'${owner.key as string}'. Choose another name property first.`,
      );
    }
    if (typeKind === "EntityType" && identityOf(owner)?.includes(prop.key as string)) {
      throw identityLocked(prop.key as string, owner.key as string, "be deleted");
    }
    // Lens allowlists never trigger the cascade protocol — without cascade
    // they are left holding an unresolvable key (harmless at runtime,
    // reported by lens validation). A custom search index reading the
    // property does: the cascade removes the field from it (deleting an
    // index left empty, with its lens inclusions). The refusal names the
    // lenses whose allowlist lists the property and those including an
    // index the cascade deletes.
    const including = await s.findLensesIncludingType(typeKind, ownerId);
    const indexPlan = await planIndexCascade(s, {
      kind: "property",
      owner: typeKind === "EntityType" ? "entityType" : "relationType",
      ownerKey: owner.key as string,
      key: prop.key as string,
    });
    if (indexPlan.affectedIndices.length > 0 && !cascade) {
      throw new CascadeRequiredError(
        `Property '${prop.key as string}' is read by ${indexPlan.affectedIndices.length} custom ` +
          `search index(es) (${indexPlan.affectedIndices.join(", ")}).`,
        [
          ...new Set([
            ...(await lensesListingProperty(s, typeKind, owner.key as string, prop.key as string, including)),
            ...indexPlan.affectedLenses,
          ]),
        ].sort(),
        indexPlan.affectedIndices,
      );
    }
    if (cascade) {
      await s.removePropertyFromIncludesLists(typeKind, ownerId, prop.key as string);
    }
    await applyIndexCascade(s, indexPlan);
    const deleted = await s.deleteProperty(ownerId, typeKind, propertyId);
    if (!deleted) {
      throw new NotFoundError(`Property '${propertyId}' not found on this type`);
    }
    if (typeKind !== "EntityType" && indexPlan.affectedIndices.length === 0) return false;
    await syncManagedDefinitions(s.searchIndices());
    return true;
  });
  if (indicesChanged) {
    await afterSchemaChange(store);
  }
}

/** The lenses (of `including`, sorted keys) whose explicit allowlist for
 * the type names the property — those the cascade changes. */
async function lensesListingProperty(
  store: ModelingStore,
  typeKind: TypeKind,
  typeKey: string,
  propertyKey: string,
  including: string[],
): Promise<string[]> {
  const listing: string[] = [];
  for (const lensKey of including) {
    const lens = await store.getLensByKey(lensKey);
    if (lens === null) continue;
    const inclusions = await store.listIncludesTypes(lens.lensId as string, typeKind);
    const inclusion = inclusions.find((inc) => inc.key === typeKey);
    if ((inclusion?.properties as string[] | null | undefined)?.includes(propertyKey)) {
      listing.push(lensKey);
    }
  }
  return listing;
}

// --- Scope Management (inclusions) ---

async function resolveLens(store: ModelingStore, lensId: string): Promise<Row> {
  const data = await store.getLens(lensId);
  if (!data) {
    throw new NotFoundError(`Lens '${lensId}' not found`);
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
  lensId: string,
  body: IncludeTypeRequestInput,
  store: ModelingStore,
): Promise<IncludeTypeResponseBody> {
  return store.changeDesign(async (s) => {
    await resolveLens(s, lensId);
    const et = await s.getEntityTypeByKey(body.key);
    if (!et) {
      throw new NotFoundError(`Entity type '${body.key}' not found`);
    }
    const properties = body.properties ?? null;
    if (properties !== null) {
      const etProps = await s.listProperties(et.entityTypeId as string, "EntityType");
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
    const data = await s.addIncludesType(lensId, "EntityType", body.key, properties);
    if (!data) {
      throw new NotFoundError(`Failed to add inclusion for entity type '${body.key}'`);
    }
    return toIncludeResponse(data);
  });
}

export async function listIncludesEntityTypes(
  lensId: string,
  store: ModelingStore,
): Promise<IncludeTypeResponseBody[]> {
  await resolveLens(store, lensId);
  const rows = await store.listIncludesTypes(lensId, "EntityType");
  return rows.map(toIncludeResponse);
}

/**
 * A lens's type inclusions as its runtime serves them — what a Reader or
 * Writer of the lens sees of its design: an inclusion whose key no longer
 * resolves, a relation type into an entity type the lens hides and a
 * property that no longer exists are left out, as the runtime's scope
 * filtering leaves them out (`runtime/schemaCache.ts`).
 */
export async function listServedIncludes(
  lensId: string,
  typeKind: TypeKind,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<IncludeTypeResponseBody[]> {
  const lens = await resolveLens(store, lensId);
  const { scoped } = await loadSchema(lens.key as string, runtime);
  const served = typeKind === "EntityType" ? scoped.entityTypes : scoped.relationTypes;
  return (await store.listIncludesTypes(lensId, typeKind)).flatMap((row) => {
    const type = served[row.key as string];
    if (type === undefined) return [];
    const { key, properties } = toIncludeResponse(row);
    return [{ key, properties: properties === null ? null : properties.filter((p) => p in type.properties) }];
  });
}

export async function updateIncludesEntityType(
  lensId: string,
  typeId: string,
  body: IncludeTypeUpdateInput,
  store: ModelingStore,
): Promise<IncludeTypeResponseBody> {
  return store.changeDesign(async (s) => {
    await resolveLens(s, lensId);
    const et = await s.getEntityType(typeId);
    if (!et) {
      throw new NotFoundError(`Entity type '${typeId}' not found`);
    }
    const properties = body.properties ?? null;
    if (properties !== null) {
      const etProps = await s.listProperties(typeId, "EntityType");
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
    const data = await s.updateIncludesType(lensId, "EntityType", typeId, properties);
    if (!data) {
      throw new NotFoundError(`Entity type '${typeId}' is not included in this lens`);
    }
    return toIncludeResponse(data);
  });
}

export async function removeIncludesEntityType(
  lensId: string,
  typeId: string,
  store: ModelingStore,
): Promise<void> {
  await store.changeDesign(async (s) => {
    await resolveLens(s, lensId);
    const deleted = await s.removeIncludesType(lensId, "EntityType", typeId);
    if (!deleted) {
      throw new NotFoundError(`Entity type '${typeId}' is not included in this lens`);
    }
  });
}

export async function addIncludesRelationType(
  lensId: string,
  body: IncludeTypeRequestInput,
  store: ModelingStore,
): Promise<IncludeTypeResponseBody> {
  return store.changeDesign(async (s) => {
    await resolveLens(s, lensId);
    const rt = await s.getRelationTypeByKey(body.key);
    if (!rt) {
      throw new NotFoundError(`Relation type '${body.key}' not found`);
    }
    // Endpoint check applies only when the lens ALREADY has entity inclusions
    // — a deliberately preserved ordering hazard: a lens with no entity
    // inclusions yet accepts any relation type inclusion unchecked, and
    // adding entity inclusions afterwards can leave an included relation
    // type whose endpoints are not exposed. Validation reports it; the
    // runtime still loads it.
    const entityInclusions = await s.listIncludesTypes(lensId, "EntityType");
    if (entityInclusions.length > 0) {
      const includedEtKeys = new Set(entityInclusions.map((inc) => inc.key as string));
      if (!includedEtKeys.has(rt.sourceEntityTypeKey as string)) {
        throw new ValidationError(
          `Source entity type '${rt.sourceEntityTypeKey}' of relation type '${body.key}' ` +
            "is not included in this lens",
        );
      }
      if (!includedEtKeys.has(rt.targetEntityTypeKey as string)) {
        throw new ValidationError(
          `Target entity type '${rt.targetEntityTypeKey}' of relation type '${body.key}' ` +
            "is not included in this lens",
        );
      }
    }
    const properties = body.properties ?? null;
    if (properties !== null) {
      const rtProps = await s.listProperties(rt.relationTypeId as string, "RelationType");
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
    const data = await s.addIncludesType(lensId, "RelationType", body.key, properties);
    if (!data) {
      throw new NotFoundError(`Failed to add inclusion for relation type '${body.key}'`);
    }
    return toIncludeResponse(data);
  });
}

export async function listIncludesRelationTypes(
  lensId: string,
  store: ModelingStore,
): Promise<IncludeTypeResponseBody[]> {
  await resolveLens(store, lensId);
  const rows = await store.listIncludesTypes(lensId, "RelationType");
  return rows.map(toIncludeResponse);
}

export async function updateIncludesRelationType(
  lensId: string,
  typeId: string,
  body: IncludeTypeUpdateInput,
  store: ModelingStore,
): Promise<IncludeTypeResponseBody> {
  return store.changeDesign(async (s) => {
    await resolveLens(s, lensId);
    const rt = await s.getRelationType(typeId);
    if (!rt) {
      throw new NotFoundError(`Relation type '${typeId}' not found`);
    }
    const properties = body.properties ?? null;
    if (properties !== null) {
      const rtProps = await s.listProperties(typeId, "RelationType");
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
    const data = await s.updateIncludesType(lensId, "RelationType", typeId, properties);
    if (!data) {
      throw new NotFoundError(`Relation type '${typeId}' is not included in this lens`);
    }
    return toIncludeResponse(data);
  });
}

export async function removeIncludesRelationType(
  lensId: string,
  typeId: string,
  store: ModelingStore,
): Promise<void> {
  await store.changeDesign(async (s) => {
    await resolveLens(s, lensId);
    const deleted = await s.removeIncludesType(lensId, "RelationType", typeId);
    if (!deleted) {
      throw new NotFoundError(`Relation type '${typeId}' is not included in this lens`);
    }
  });
}

// --- Schema Validation ---

interface SchemaValidationErrorItem {
  path: string;
  message: string;
}

/**
 * Validate the schema half: the same four conditions the create
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

  return { valid: errors.length === 0, errors, warnings: [] };
}

/**
 * Validate one lens's declarations against the schema. An unscoped lens —
 * no type inclusions — is valid by definition. Always answers, never
 * raises (except for an unknown lens id).
 *
 * Warnings never make the lens invalid: they name what limits the search
 * indices it includes (`lensIndexWarnings`) — an index whose root type it
 * no longer exposes, properties an index reads that it hides.
 */
export async function validateLens(
  lensId: string,
  store: ModelingStore,
): Promise<ValidationResultBody> {
  const lens = await store.getLens(lensId);
  if (!lens) {
    throw new NotFoundError(`Lens '${lensId}' not found`);
  }

  const schema = await store.getFullSchema();

  const errors: SchemaValidationErrorItem[] = [];
  const lensKey = lens.key as string;

  const lensData = (schema.lenses as Row[]).find((o) => o.lensId === lensId);
  if (!lensData) {
    return { valid: true, errors: [], warnings: [] };
  }

  const entityInclusions = (lensData.entityInclusions as Row[] | undefined) ?? [];
  const relationInclusions = (lensData.relationInclusions as Row[] | undefined) ?? [];

  if (entityInclusions.length === 0 && relationInclusions.length === 0) {
    return { valid: true, errors: [], warnings: [] };
  }

  const etMap = new Map((schema.entityTypes as Row[]).map((et) => [et.key as string, et]));
  const rtMap = new Map((schema.relationTypes as Row[]).map((rt) => [rt.key as string, rt]));

  const includedEtKeys = new Set<string>();
  for (const inc of entityInclusions) {
    const incKey = inc.key as string;
    const et = etMap.get(incKey);
    if (!et) {
      errors.push({
        path: `lenses.${lensKey}.includes.entityTypes.${incKey}`,
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
            path: `lenses.${lensKey}.includes.entityTypes.${incKey}.properties`,
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
            path: `lenses.${lensKey}.includes.entityTypes.${incKey}.properties`,
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
        path: `lenses.${lensKey}.includes.relationTypes.${incKey}`,
        message: `Relation type '${incKey}' does not exist`,
      });
      continue;
    }
    // Endpoint exposure re-checked here — the one place the ordering
    // hazard from addIncludesRelationType is reported.
    if (includedEtKeys.size > 0) {
      if (!includedEtKeys.has(rt.sourceKey as string)) {
        errors.push({
          path: `lenses.${lensKey}.includes.relationTypes.${incKey}`,
          message: `Source entity type '${rt.sourceKey}' is not included`,
        });
      }
      if (!includedEtKeys.has(rt.targetKey as string)) {
        errors.push({
          path: `lenses.${lensKey}.includes.relationTypes.${incKey}`,
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
            path: `lenses.${lensKey}.includes.relationTypes.${incKey}.properties`,
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
            path: `lenses.${lensKey}.includes.relationTypes.${incKey}.properties`,
            message: `Required property '${p.key}' without default must be included`,
          });
        }
      }
    }
  }

  const full = buildSchemaCacheFromRaw(
    lensData,
    schema.entityTypes as Row[],
    schema.relationTypes as Row[],
  );
  const scoped = applyScopeFiltering(
    full,
    entityInclusions as { key: string; properties: string[] | null }[],
    relationInclusions as { key: string; properties: string[] | null }[],
  );
  const warnings = await lensIndexWarnings(store, { lensId, key: lensKey }, full, scoped);

  return { valid: errors.length === 0, errors, warnings };
}

/** Validate the schema and then every lens: one combined list each of
 * errors and warnings. */
export async function validateAll(store: ModelingStore): Promise<ValidationResultBody> {
  const schemaResult = await validateSchema(store);
  const errors = [...schemaResult.errors];
  const warnings = [...schemaResult.warnings];

  const lenses = await store.listLenses();
  for (const lens of lenses) {
    const lensResult = await validateLens(lens.lensId as string, store);
    errors.push(...lensResult.errors);
    warnings.push(...lensResult.warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// --- Rebuild search data ---

/**
 * Rebuild the vectors stored outside search indices, which maintain
 * themselves: the saved-query descriptions' vectors and their index.
 *
 * It runs without a provider and then writes no vectors; the summary
 * reports that omission as `embeddingsSkipped`.
 *
 * Yields NDJSON progress lines (`docs/capabilities/search.md#rebuild`):
 * one progress record per processed item carrying its group key, the
 * count so far and the group total, then a final summary with the
 * overall totals.
 */
export async function* rebuildSearchData(store: ModelingStore): AsyncGenerator<string> {
  const provider = getEmbeddingProvider();

  // Phase one of three: drop every index whose width no longer matches
  // the provider. It cannot be merged into the create below. An index
  // fixes its width when it is created, so while a drifted one stands,
  // storing a vector of the provider's width fails — the vectors cannot
  // be regenerated underneath it, and it cannot be built over the old
  // ones. Nothing is dropped when the widths already agree. With no
  // provider there is no width to reconcile against and no index to hold.
  if (provider) {
    await store.dropMismatchedVectorIndexes(provider.dimensions);
  }

  // Phase two: re-embed every saved-query description. Discovery ranks
  // descriptions by vector alone, so with no provider there is nothing
  // here to rebuild.
  let sqProcessed = 0;
  let sqFailed = 0;

  if (provider) {
    const savedQueries = await store.listSavedQueryRefs();
    const sqTotal = savedQueries.length;

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

    // Phase three: every vector now has the provider's width, so the
    // indexes phase one dropped — and any the schema calls for and never
    // had — can be built. It comes before the summary: that line is what
    // tells the caller the rebuild is done, and it is not done while the
    // indexes it dropped are still missing.
    await store.ensureVectorIndexes(provider.dimensions);
  }

  // Final summary. `embeddingsSkipped` is what tells a caller that a run
  // reporting no failures nevertheless wrote no vectors.
  yield `${JSON.stringify({
    type: "summary",
    entityTypes: [],
    savedQueriesProcessed: sqProcessed,
    savedQueriesFailed: sqFailed,
    totalProcessed: sqProcessed,
    totalFailed: sqFailed,
    embeddingsSkipped: !provider,
  })}\n`;

  console.info(
    `Rebuild search data complete: ${sqProcessed} processed, ${sqFailed} failed` +
      (provider ? "" : " (embeddings skipped: no provider)"),
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
 * The ontology's whole schema in the transfer format
 * (`docs/capabilities/transfer.md`): the keyword language set, the search
 * indices (custom definitions and switched-off managed indices), entity
 * types, relation types, lenses with their inclusions, and each lens's
 * assistants and saved queries — no timestamps, no internal ids, no instance
 * data. This is both
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
    nameProperty: et.nameProperty,
    // Omitted for a type without an identity, so a design without one
    // exports as before.
    ...(identityOf(et) === null ? {} : { identityProperties: identityOf(et) }),
    properties: ((et.properties as Row[] | undefined) ?? []).map(exportProperty),
  }));

  const relationTypes = (schema.relationTypes as Row[]).map((rt) => ({
    key: rt.key,
    displayName: rt.displayName,
    description: optString(rt.description),
    fromEntityTypeKey: rt.sourceKey,
    toEntityTypeKey: rt.targetKey,
    parent: (rt.parent as ParentEnd | null | undefined) ?? null,
    properties: ((rt.properties as Row[] | undefined) ?? []).map(exportProperty),
  }));

  const indices = store.searchIndices();
  const lenses: Row[] = [];
  for (const lens of schema.lenses as Row[]) {
    const entityInclusions = (lens.entityInclusions as Row[] | undefined) ?? [];
    const relationInclusions = (lens.relationInclusions as Row[] | undefined) ?? [];

    const exported: Row = {
      key: lens.key,
      name: lens.name,
      description: optString(lens.description),
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
    exported.indexInclusions = await indices.listLensIndexInclusions(lens.lensId as string);

    const agentRows = await store.listAgentsForExport(lens.lensId as string);
    const assistants: Row = {
      agents: agentRows.map((ag) => ({
        key: ag.key,
        name: ag.name,
        description: optString(ag.description),
        systemPrompt: optString(ag.systemPrompt),
        tools: (ag.tools as string[] | null | undefined) ?? null,
      })),
    };
    assistants.retrievers = (await indices.listRetrievers(lens.lensId as string)).map(
      portableRetriever,
    );
    assistants.navigators = (await store.navigators().listNavigators(lens.lensId as string)).map(
      portableNavigator,
    );
    exported.assistants = assistants;

    const queryRows = await store.listSavedQueriesForExport(lens.lensId as string);
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
    lenses.push(exported);
  }

  const keywordLanguages = [...(await indices.getSearchSettings()).keywordLanguages];

  return {
    formatVersion: TRANSFER_FORMAT_VERSION,
    keywordLanguages,
    searchIndices: await exportSearchIndices(indices),
    entityTypes,
    relationTypes,
    lenses,
  };
}

// --- Import (transfer format) ---

/**
 * Import a transfer payload: create the types, then the lenses
 * with their inclusions, assistants and saved queries.
 *
 * Validate-then-write: the ENTIRE payload is
 * validated before anything is written — every rule violation collected
 * into one 422, every key conflict into one 409 — and a rejected import
 * leaves the database untouched. Rule violations are reported before
 * conflicts: they are intrinsic to the payload file, while conflicts
 * depend on the target. Last, the payload's parent relations are checked
 * against the relations stored in the target, refused with one 409 and
 * the violation list as a flag write is. The saved-query descriptions are
 * embedded before anything is written; the checks against the target and
 * every write are then one design change, so a failure at any point —
 * the provider's included — leaves the target as it was.
 *
 * Every imported key is validated against the same patterns the
 * interactive paths enforce, closing the `_id`-property hole
 * `docs/architecture.md` documents. Property data types are deliberately
 * NOT checked against the enum — the schema-validation operation catches
 * that later (`docs/capabilities/transfer.md`).
 *
 * The importer reads the current format version only: an older payload
 * is brought up to it by the upgrade chain first
 * (`transfer/upgrades.ts`), which checks the fields each version reads
 * in that version's terms. Each entity type names its name property,
 * which must be a string property of that type.
 *
 * The payload's `keywordLanguages` become the target's set. Its
 * `searchIndices` — custom definitions, each validated against the
 * payload's own schema, and the switched-off managed indices — join the
 * target's. A lens's `indexInclusions` name indices of either kind and
 * are written as they come once the indices exist; a lens without them
 * includes the managed indices of the types it exposes — a passage index
 * only when it exposes the document property too — as the storage step's
 * upgrade does. Import provisions no entries: the generations it
 * reconciles are built by the worker.
 */
/** The import errors of one entity type's identity, against the payload's
 * own properties: the rules a modeling write checks, the flags included,
 * since import never cascades. */
function importedIdentityErrors(et: z.infer<typeof ExportPayload>["entityTypes"][number]): string[] {
  const identity = et.identityProperties ?? null;
  if (identity === null) return [];
  const subject = `Import error: the identity of entity type '${et.key}'`;
  if (identity.length === 0 || identity.length > MAX_IDENTITY_PROPERTIES) {
    return [`${subject} must have 1 to ${MAX_IDENTITY_PROPERTIES} properties`];
  }
  const errors: string[] = [];
  identity.forEach((key, index) => {
    if (identity.indexOf(key) !== index) {
      errors.push(`${subject} lists '${key}' twice`);
      return;
    }
    const prop = et.properties.find((candidate) => candidate.key === key);
    if (prop === undefined) {
      errors.push(`${subject} names '${key}', which is not one of its properties`);
    } else if (!IDENTITY_DATA_TYPES.includes(prop.dataType)) {
      errors.push(`${subject} names '${key}', a ${prop.dataType} property`);
    } else if (!prop.required || (prop.defaultValue !== null && prop.defaultValue !== undefined)) {
      errors.push(`${subject} names '${key}', which must be required and have no default`);
    }
  });
  return errors;
}

export async function importSchema(
  body: unknown,
  store: ModelingStore,
): Promise<Row> {
  const { payload: upgraded, retrieverWarnings } = upgradeToCurrent(body);
  if (upgraded.keywordLanguages === undefined) {
    throw new ValidationError("The payload carries no keywordLanguages", {
      fields: { keywordLanguages: "Required" },
    });
  }
  const payload = readFields(ExportPayload, upgraded);
  const { keywordLanguages, searchIndices: payloadIndices } = payload;

  // ---- Phase 1: payload-intrinsic validation (collect everything) ----
  const errors: string[] = [];

  const badKey = (kind: string, key: string, pattern: string): string =>
    `Import error: invalid ${kind} key '${key}'. Must match pattern: ${pattern}`;
  const longKey = (kind: string, key: string): string =>
    `Import error: invalid ${kind} key '${key}'. ` +
    `Maximum length is ${MAX_KEY_LENGTH} characters`;
  const schemaKeyPattern = SCHEMA_KEY_PATTERN.source;
  const resourceKeyPattern = LENS_RESOURCE_KEY_PATTERN.source;

  for (const et of payload.entityTypes) {
    if (et.nameProperty === undefined) {
      errors.push(`Import error: entity type '${et.key}' has no nameProperty`);
    } else if (
      !et.properties.some(
        (prop) => prop.key === et.nameProperty && prop.dataType === NAME_PROPERTY_DATA_TYPE,
      )
    ) {
      errors.push(
        `Import error: name property '${et.nameProperty}' of entity type '${et.key}' ` +
          `is not a ${NAME_PROPERTY_DATA_TYPE} property of that type`,
      );
    }
    errors.push(...importedIdentityErrors(et));
    if (!SCHEMA_KEY_PATTERN.test(et.key)) {
      errors.push(badKey("entity type", et.key, schemaKeyPattern));
    }
    if (et.key.length > MAX_KEY_LENGTH) {
      errors.push(longKey("entity type", et.key));
    }
    for (const prop of et.properties) {
      if (!SCHEMA_KEY_PATTERN.test(prop.key)) {
        errors.push(
          `Import error: invalid property key '${prop.key}' on entity type ` +
            `'${et.key}'. Must match pattern: ${schemaKeyPattern}`,
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
    if (!SCHEMA_KEY_PATTERN.test(rt.key)) {
      errors.push(badKey("relation type", rt.key, schemaKeyPattern));
    }
    if (rt.key.length > MAX_KEY_LENGTH) {
      errors.push(longKey("relation type", rt.key));
    }
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
      if (!SCHEMA_KEY_PATTERN.test(prop.key)) {
        errors.push(
          `Import error: invalid property key '${prop.key}' on relation type ` +
            `'${rt.key}'. Must match pattern: ${schemaKeyPattern}`,
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

  // Retrievers: only the shape is checked here — what a retriever
  // references is reported invalid on read, so an export of a retriever that
  // became invalid still imports.
  for (const lens of payload.lenses) {
    const seen = new Set<string>();
    for (const retriever of lens.assistants.retrievers) {
      if (seen.has(retriever.key)) errors.push(`Import error: duplicate retriever '${retriever.key}' in lens '${lens.key}'`);
      seen.add(retriever.key);
      if (!LENS_RESOURCE_KEY_PATTERN.test(retriever.key)) errors.push(badKey("retriever", retriever.key, resourceKeyPattern));
      if (retriever.key.length > MAX_KEY_LENGTH) errors.push(longKey("retriever", retriever.key));
      if (retriever.name.length === 0 || retriever.name.length > 200) {
        errors.push(`Import error: retriever '${retriever.key}' needs a name of 1 to 200 characters`);
      }
      if (
        retriever.configVersion !== RETRIEVER_CONFIG_VERSION ||
        !RetrieverConfig.safeParse(retriever.config).success
      ) {
        errors.push(
          `Import error: retriever '${retriever.key}' has no valid configuration of version ` +
            `${RETRIEVER_CONFIG_VERSION}`,
        );
      }
    }
  }

  // Navigators: shape only, as for retrievers.
  for (const lens of payload.lenses) {
    const seen = new Set<string>();
    for (const navigator of lens.assistants.navigators) {
      if (seen.has(navigator.key)) errors.push(`Import error: duplicate navigator '${navigator.key}' in lens '${lens.key}'`);
      seen.add(navigator.key);
      if (!LENS_RESOURCE_KEY_PATTERN.test(navigator.key)) errors.push(badKey("navigator", navigator.key, resourceKeyPattern));
      if (navigator.key.length > MAX_KEY_LENGTH) errors.push(longKey("navigator", navigator.key));
      if (navigator.name.length === 0 || navigator.name.length > 200) {
        errors.push(`Import error: navigator '${navigator.key}' needs a name of 1 to 200 characters`);
      }
      if (
        navigator.configVersion !== NAVIGATOR_CONFIG_VERSION ||
        !NavigatorConfig.safeParse(navigator.config).success
      ) {
        errors.push(
          `Import error: navigator '${navigator.key}' has no valid configuration of version ` +
            `${NAVIGATOR_CONFIG_VERSION}`,
        );
      }
    }
  }

  for (const lens of payload.lenses) {
    if (!SCHEMA_KEY_PATTERN.test(lens.key)) {
      errors.push(badKey("lens", lens.key, schemaKeyPattern));
    }
    if (lens.key.length > MAX_KEY_LENGTH) {
      errors.push(longKey("lens", lens.key));
    }
    for (const ag of lens.assistants.agents) {
      if (!LENS_RESOURCE_KEY_PATTERN.test(ag.key)) {
        errors.push(badKey("agent", ag.key, resourceKeyPattern));
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
    for (const sq of lens.savedQueries) {
      if (!LENS_RESOURCE_KEY_PATTERN.test(sq.key)) {
        errors.push(badKey("saved query", sq.key, resourceKeyPattern));
      }
      if (sq.key.length > MAX_KEY_LENGTH) {
        errors.push(longKey("saved query", sq.key));
      }
      let stepsKnown = true;
      for (const s of sq.steps) {
        if (s.type !== "oql" && s.type !== "search") {
          errors.push(
            `Import error: saved query '${sq.key}' has step '${s.name}' with ` +
              `unknown type '${s.type}'; expected oql or search`,
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

  // Search indices: each custom definition valid against the payload's
  // own schema, each switch naming a managed index it derives, each lens's
  // index inclusion naming an index of either kind.
  const indexSchema = buildSchemaCacheFromRaw(
    { lensId: "import", key: "import", name: "import" },
    payload.entityTypes as unknown as Row[],
    payload.relationTypes.map((rt) => ({
      ...rt,
      sourceKey: rt.fromEntityTypeKey,
      targetKey: rt.toEntityTypeKey,
    })) as unknown as Row[],
  );
  if (payloadIndices !== undefined) {
    errors.push(...importedIndexErrors(payloadIndices, indexSchema));
  }
  errors.push(
    ...importedInclusionErrors(
      payload.lenses.map((lens) => ({ key: lens.key, indexInclusions: lens.indexInclusions })),
      payloadIndices,
      indexSchema,
    ),
  );

  if (errors.length > 0) {
    throw new ValidationError(errors.join("; "), { errors });
  }

  // Every saved-query description is embedded before anything is written,
  // so imported queries are semantically discoverable immediately — and a
  // provider that fails leaves the target untouched, with no lock held
  // while it answers.
  const provider = getEmbeddingProvider();
  const embeddings = new Map<object, number[] | null>();
  for (const lens of payload.lenses) {
    for (const sq of lens.savedQueries) {
      embeddings.set(sq, provider ? await provider.embed(sq.description) : null);
    }
  }

  // Phases 2 to 4 are one design change: the import applies whole or not
  // at all.
  const createdLenses = await store.changeDesign(async (target) => {
    // ---- Phase 2: conflicts — all-or-fail, naming EVERY conflicting key ----
    // An intra-payload duplicate reports the same conflict a sequential
    // write of the payload would have produced.
    const conflicts: string[] = [];

    const seenEtKeys = new Set<string>();
    for (const et of payload.entityTypes) {
      if (seenEtKeys.has(et.key) || (await target.getEntityTypeByKey(et.key))) {
        conflicts.push(`Entity type with key '${et.key}' already exists`);
      }
      seenEtKeys.add(et.key);
    }
    const seenRtKeys = new Set<string>();
    for (const rt of payload.relationTypes) {
      if (seenRtKeys.has(rt.key) || (await target.getRelationTypeByKey(rt.key))) {
        conflicts.push(`Relation type with key '${rt.key}' already exists`);
      }
      seenRtKeys.add(rt.key);
    }
    const seenLensKeys = new Set<string>();
    for (const lens of payload.lenses) {
      if (seenLensKeys.has(lens.key) || (await target.getLensByKey(lens.key))) {
        conflicts.push(`Lens with key '${lens.key}' already exists`);
      }
      seenLensKeys.add(lens.key);
    }

    if (payloadIndices !== undefined) {
      conflicts.push(...(await importedIndexConflicts(target, payloadIndices)));
    }

    if (conflicts.length > 0) {
      throw new ConflictError(conflicts.join("; "));
    }

    // ---- Phase 3: the parent rules over the target's stored relations ----
    // Deleting a type keeps its instances, so relation rows may already be
    // stored under an imported parent relation's key. They are read across
    // the target's parent relations and the payload's together.
    const parentReadings = Object.fromEntries(
      payload.relationTypes.flatMap((rt) => (rt.parent ? [[rt.key, rt.parent]] : [])),
    ) as Record<string, ParentEnd>;
    if (Object.keys(parentReadings).length > 0) {
      const violations = await target.findParentViolations(parentReadings);
      if (violations.length > 0) {
        throw parentRulesBroken("Import error: the imported parent relations are refused", violations);
      }
    }

    // ---- Phase 4: write (internal ids regenerated, keys preserved) ----
    for (const et of payload.entityTypes) {
      const etId = randomUUID();
      const properties = et.properties;
      // Validated above: the name property is among the properties.
      const named = properties.find((prop) => prop.key === et.nameProperty)!;
      await target.createEntityType(etId, et.key, et.displayName, et.description ?? null, {
        propertyId: randomUUID(),
        key: named.key,
        displayName: named.displayName,
        description: named.description ?? null,
        dataType: named.dataType,
        required: named.required,
        defaultValue: named.defaultValue ?? null,
      });
      for (const prop of properties) {
        if (prop === named) {
          continue;
        }
        await target.createProperty(
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
      // After its properties, before any lens: validated above, so only
      // the entities a deleted type of the key left behind can refuse it.
      const identity = et.identityProperties ?? null;
      if (identity !== null) {
        await setIdentity(target, (await target.getEntityType(etId))!, identity, false);
      }
    }

    for (const rt of payload.relationTypes) {
      const rtId = randomUUID();
      const written = await target.createRelationType(
        rtId,
        rt.key,
        rt.displayName,
        rt.description ?? null,
        rt.fromEntityTypeKey,
        rt.toEntityTypeKey,
        rt.parent ?? null,
      );
      // Checked above; only a racing relation write can make it refuse now.
      if ("violations" in written) {
        throw parentRulesBroken(
          `Import error: relation type '${rt.key}' cannot be created with parent end '${rt.parent}'`,
          written.violations,
        );
      }
      for (const prop of rt.properties) {
        await target.createProperty(
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

    const createdLenses: LensResponseBody[] = [];
    const lensIds = new Map<ExportLensInput, string>();
    for (const lens of payload.lenses) {
      const lensId = randomUUID();
      lensIds.set(lens, lensId);
      const lensData = await target.createLens(lensId, lens.key, lens.name, lens.description ?? null);

      // Inclusions are written WITHOUT the four inclusion rules — lens
      // validation reports any damage (`docs/capabilities/transfer.md`).
      if (lens.includes) {
        for (const inc of lens.includes.entityTypes) {
          await target.addIncludesType(lensId, "EntityType", inc.key, inc.properties ?? null);
        }
        for (const inc of lens.includes.relationTypes) {
          await target.addIncludesType(lensId, "RelationType", inc.key, inc.properties ?? null);
        }
      }

      for (const ag of lens.assistants.agents) {
        await target.upsertAgent(
          lensId,
          randomUUID(),
          ag.key,
          ag.name,
          ag.description ?? null,
          ag.systemPrompt ?? null,
          ag.tools ?? null,
        );
      }

      for (const sq of lens.savedQueries) {
        const stepsJson = JSON.stringify(
          sq.steps.map((s) => ({
            name: s.name,
            type: s.type,
            ...(s.oql ? { oql: s.oql } : {}),
            ...(s.entityTypeKey ? { entityTypeKey: s.entityTypeKey } : {}),
            ...(s.query ? { query: s.query } : {}),
            ...(s.limit !== null && s.limit !== undefined ? { limit: s.limit } : {}),
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
        await target.upsertSavedQuery(
          lensId,
          randomUUID(),
          sq.key,
          sq.name,
          sq.description,
          stepsJson,
          paramsJson,
          lens.key,
          embeddings.get(sq) ?? null,
        );
      }

      createdLenses.push(toLensResponse(lensData));
    }

    const indices = target.searchIndices();
    const settings = await indices.getSearchSettings();
    await indices.setSearchSettings({ ...settings, keywordLanguages });
    // The managed indices derive in the sync below; the generations are
    // reconciled after the commit: import provisions no entries, the worker
    // builds.
    if (payloadIndices !== undefined) {
      await importSearchIndices(target, payloadIndices);
    }
    await syncManagedDefinitions(indices);
    // The sync included each new managed index in the scoped lenses that
    // expose its root type (a passage index: its document property too) —
    // what a lens without index inclusions keeps. A lens's own list replaces
    // that, now that every index exists.
    for (const lens of payload.lenses) {
      if (lens.indexInclusions !== undefined) {
        await importLensIndexInclusions(target, lensIds.get(lens)!, lens.indexInclusions);
      }
    }
    // Retrievers last, once their indices exist; navigators beside them.
    for (const lens of payload.lenses) {
      for (const retriever of lens.assistants.retrievers) {
        await indices.saveRetriever(
          lensIds.get(lens)!,
          {
            retrieverId: randomUUID(),
            key: retriever.key,
            name: retriever.name,
            description: retriever.description,
            configVersion: RETRIEVER_CONFIG_VERSION,
            config: RetrieverConfig.parse(retriever.config),
            // An upgraded retriever keeps its conversion's warnings.
            warnings: retrieverWarnings.get(retrieverWarningKey(lens.key, retriever.key)) ?? [],
          },
          true,
        );
      }
      for (const navigator of lens.assistants.navigators) {
        await target.navigators().saveNavigator(
          lensIds.get(lens)!,
          {
            navigatorId: randomUUID(),
            key: navigator.key,
            name: navigator.name,
            description: navigator.description,
            configVersion: NAVIGATOR_CONFIG_VERSION,
            config: NavigatorConfig.parse(navigator.config),
          },
          true,
        );
      }
    }
    return createdLenses;
  });

  // The shared saved-query index is ensured once at the end.
  // Best effort like the reconcile: the boot ensures it again.
  if (provider) {
    await afterCommit(requireSearchIndices(store).ontologyKey, () =>
      store.ensureSavedQueryVectorIndex(provider.dimensions),
    );
  }
  await afterSchemaChange(store);
  return { lenses: createdLenses };
}

// --- Search settings ---

export async function getSearchSettings(store: ModelingStore): Promise<SearchSettingsResponseBody> {
  return readSearchSettings(requireSearchIndices(store));
}

/**
 * Change the keyword language set and/or which managed indices are off;
 * an absent field stays as it is. Every change reconciles the
 * generations — a new language set yields new keyword generations for
 * every index (`runtime/indexing/settings.ts`).
 */
export async function updateSearchSettings(
  body: SearchSettingsUpdateInput,
  store: ModelingStore,
): Promise<SearchSettingsResponseBody> {
  const result = await store.changeDesign((s) => changeSearchSettings(requireSearchIndices(s), body));
  const ontologyKey = requireSearchIndices(store).ontologyKey;
  await afterCommit(ontologyKey, () => reconcileSearchGenerations(ontologyKey));
  return result;
}

// --- Agent Config ---

/** Render a list the way error messages spell one: `['a', 'b']`. */
function pyList(items: string[]): string {
  return `[${items.map((item) => `'${item}'`).join(", ")}]`;
}

async function resolveLensByKey(store: ModelingStore, lensKey: string): Promise<Row> {
  const lens = await store.getLensByKey(lensKey);
  if (!lens) {
    throw new NotFoundError(`Lens '${lensKey}' not found`);
  }
  return lens;
}

function toAgentResponse(data: Row): AgentConfigResponseBody {
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

export async function listAgents(
  lensKey: string,
  store: ModelingStore,
): Promise<AgentConfigResponseBody[]> {
  const lens = await resolveLensByKey(store, lensKey);
  const rows = await store.listAgents(lens.lensId as string);
  return rows.map(toAgentResponse);
}

export async function getAgent(
  lensKey: string,
  agentKey: string,
  store: ModelingStore,
): Promise<AgentConfigResponseBody> {
  const lens = await resolveLensByKey(store, lensKey);
  const row = (await store.listAgents(lens.lensId as string)).find((data) => data.key === agentKey);
  if (!row) {
    throw new NotFoundError(`Agent '${agentKey}' not found`);
  }
  return toAgentResponse(row);
}

/** Upsert by key. Returns `[response, created]`. */
export async function upsertAgent(
  lensKey: string,
  agentKey: string,
  body: AgentConfigUpsertInput,
  store: ModelingStore,
): Promise<[AgentConfigResponseBody, boolean]> {
  if (!LENS_RESOURCE_KEY_PATTERN.test(agentKey)) {
    throw new ValidationError(
      `Invalid agent key '${agentKey}'. Must match pattern: ${LENS_RESOURCE_KEY_PATTERN.source}`,
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

  const [data, created] = await store.changeDesign(async (s) => {
    const lens = await resolveLensByKey(s, lensKey);
    const agentConfigId = randomUUID();
    return s.upsertAgent(
      lens.lensId as string,
      agentConfigId,
      agentKey,
      body.name,
      body.description ?? null,
      body.systemPrompt ?? null,
      tools,
    );
  });
  return [toAgentResponse(data), created];
}

export async function deleteAgent(
  lensKey: string,
  agentKey: string,
  store: ModelingStore,
): Promise<void> {
  await store.changeDesign(async (s) => {
    const lens = await resolveLensByKey(s, lensKey);
    const deleted = await s.deleteAgent(lens.lensId as string, agentKey);
    if (!deleted) {
      throw new NotFoundError(`Agent '${agentKey}' not found`);
    }
  });
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
    } else if (step.type === "search") {
      if (!step.entityTypeKey) {
        errors.push(`${prefix}.entityTypeKey: Required for search steps`);
      }
      if (!step.query) {
        errors.push(`${prefix}.query: Required for search steps`);
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
  // $param refs in search query fields are always caller-supplied.
  for (const step of steps) {
    if (step.type === "search" && step.query) {
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
  lensKey: string,
  store: ModelingStore,
): Promise<SavedQueryResponseBody[]> {
  const lens = await resolveLensByKey(store, lensKey);
  const rows = await store.listSavedQueries(lens.lensId as string);
  return rows.map(toSavedQueryResponse);
}

/** Upsert by key. Returns `[response, created]`. */
export async function upsertSavedQuery(
  lensKey: string,
  queryKey: string,
  body: SavedQueryUpsertInput,
  store: ModelingStore,
  runtimeStore: RuntimeStore,
): Promise<[SavedQueryResponseBody, boolean]> {
  if (!LENS_RESOURCE_KEY_PATTERN.test(queryKey)) {
    throw new ValidationError(
      `Invalid query key '${queryKey}'. Must match pattern: ${LENS_RESOURCE_KEY_PATTERN.source}`,
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

  await resolveLensByKey(store, lensKey);

  // Validate each oql step against the lens's schema — skipped ONLY when
  // that schema cannot be loaded (the run-time check still applies then).
  // Cache-free on purpose: validate against the currently persisted schema.
  // The runtime cache is scoped by ontology and lens.
  try {
    const loaded = await loadSchemaUncached(lensKey, runtimeStore);
    for (const step of body.steps) {
      if (step.type === "oql" && step.oql) {
        parseAndValidate(step.oql, loaded.scoped);
      }
    }
  } catch (exc) {
    if (exc instanceof NotFoundError) {
      // Lens has no runtime schema loaded yet.
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

  const [data, created] = await store.changeDesign(async (s) => {
    const lens = await resolveLensByKey(s, lensKey);
    const savedQueryId = randomUUID();
    return s.upsertSavedQuery(
      lens.lensId as string,
      savedQueryId,
      queryKey,
      body.name,
      body.description,
      stepsJson,
      paramsJson,
      lensKey,
      embedding,
    );
  });
  return [toSavedQueryResponse(data), created];
}

export async function deleteSavedQuery(
  lensKey: string,
  queryKey: string,
  store: ModelingStore,
): Promise<void> {
  await store.changeDesign(async (s) => {
    const lens = await resolveLensByKey(s, lensKey);
    const deleted = await s.deleteSavedQuery(lens.lensId as string, queryKey);
    if (!deleted) {
      throw new NotFoundError(`Saved query '${queryKey}' not found`);
    }
  });
}
