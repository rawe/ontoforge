/**
 * Runtime service: schema introspection through a lens, and the entity
 * instance lifecycle with the validating write pipeline. REST and the
 * runtime MCP server are two entrances to these same functions, so no rule
 * may live in a router.
 *
 * The two contractual properties of the write pipeline
 * (`docs/architecture.md#request-lifecycle`):
 *
 * - ALL errors are collected — one rejected write names every offending
 *   field at once in `details.fields`.
 * - Writes validate against the LENS; defaults come from the FULL schema
 *   (`docs/decisions.md#schema-and-data`). A hidden property with a default is
 *   applied; a hidden property in the payload is an unknown property.
 *
 * The seven write functions take the anchor key of an anchored mount as
 * their last argument; null on the plain lens mount. On an anchored call
 * they consult the write guard (`anchorGuard.ts`) before the write.
 *
 * Six of them (entity and relation create, update, delete) compose their
 * write through a pure `prepare…` (`prepare.ts`), then run what reads
 * storage here: load schema → guard → `prepare…` → reads and checks →
 * search plan → store call.
 */

import { randomUUID } from "node:crypto";

import { CoercionError, assertNoNulCharacter, coerceValue, valueToText } from "../core/dataTypes.js";
import { getEmbeddingProvider } from "../core/embedding.js";
import { ConflictError, NotFoundError, ValidationError } from "../core/exceptions.js";
import { SYSTEM_PROPERTIES, getReturnVariables, parseAndValidate } from "../core/oql/index.js";
import type { RuntimeStore, SearchWritePlan } from "../core/ports.js";
import type { ParentEnd, PropertyDef } from "../core/schemas.js";
import { planSearchWrite, type SearchChange } from "../core/searchDependencies.js";
import { AnchorGuard } from "./anchorGuard.js";
import { cpIndexOf, cpLength, cpSlice, countOccurrences } from "./codePoints.js";
import {
  prepareCreateEntity,
  prepareCreateRelation,
  prepareDeleteEntity,
  prepareDeleteRelation,
  prepareUpdateEntity,
  prepareUpdateRelation,
  scopedEntityType,
  scopedRelationType,
  type ParentRelationInput,
} from "./prepare.js";
import { isQueryPath } from "./queryPaths.js";
import {
  loadSchema,
  loadSearchContext,
  type EntityTypeDef,
  type LoadedSchema,
  type RelationTypeDef,
  type SchemaCacheValue,
} from "./schemaCache.js";

import {
  docLengthKey,
  stubDocumentProperties,
  filterEntityProperties,
  filterRelationProperties,
  applyFieldProjection,
  parseFilterConditions,
  ENTITY_ALWAYS_FIELDS,
  ENTITY_NEIGHBOR_ALWAYS_FIELDS,
  RELATION_ALWAYS_FIELDS,
} from "./readHelpers.js";
import { search } from "./search/entry.js";

export { parseFilters, parseFilterConditions, docLengthKey } from "./readHelpers.js";
export { search } from "./search/entry.js";
export { searchByIndices, searchIndexCatalog } from "./search/indexSearch.js";

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Search work of a write
// ---------------------------------------------------------------------------

/**
 * The search work a write causes, handed to the store with the write so
 * both commit together; the search worker (`runtime/indexing/`) builds
 * the entries from it later. Null when no index reads what the write
 * changes.
 */
async function searchPlan(store: RuntimeStore, change: SearchChange): Promise<SearchWritePlan | null> {
  const context = await loadSearchContext(store.ontologyKey, store.searchIndices());
  return planSearchWrite(context.dependencies, change);
}

// ---------------------------------------------------------------------------
// Parent relations
// ---------------------------------------------------------------------------

/** The refusal of an entity delete while the entity still has children.
 * It names no type, id or count, so a lens hiding the children reveals
 * only that one exists. */
export const HAS_CHILDREN_MESSAGE = "This entity has children; delete them first";

/** Every parent relation of the FULL schema, as relation type key →
 * parent end: the parent rules hold across all of them, whatever the
 * lens shows. Empty when the ontology flags none. */
export function parentReadings(schema: SchemaCacheValue): Record<string, ParentEnd> {
  const readings: Record<string, ParentEnd> = {};
  for (const rt of Object.values(schema.relationTypes)) {
    if (rt.parent !== null) {
      readings[rt.key] = rt.parent;
    }
  }
  return readings;
}

// ---------------------------------------------------------------------------
// Document properties (stub read model)
// ---------------------------------------------------------------------------

const SYSTEM_SORT_FIELDS: Record<string, string> = {
  createdAt: "_createdAt",
  updatedAt: "_updatedAt",
  _createdAt: "_createdAt",
  _updatedAt: "_updatedAt",
};

/** Accept any scoped property key plus the timestamps — by their system
 * names or their underscore-less aliases (which exist only for sorting). */
export function validateSortField(
  sort: string,
  propertyDefs: Record<string, PropertyDef>,
): string {
  const system = SYSTEM_SORT_FIELDS[sort];
  if (system !== undefined) {
    return system;
  }
  if (sort in propertyDefs) {
    return sort;
  }
  if (isQueryPath(sort)) {
    throw new ValidationError("Sorting by query paths is not supported", {
      fields: { sort: `'${sort}' is a query path; sorting by query paths is not supported` },
    });
  }
  throw new ValidationError(`Invalid sort field: '${sort}'`, {
    fields: { sort: `'${sort}' is not a valid sort field` },
  });
}

// ---------------------------------------------------------------------------
// Schema introspection (from the cache)
// ---------------------------------------------------------------------------

function propertyToExport(p: PropertyDef): Row {
  return {
    key: p.key,
    displayName: p.displayName,
    description: p.description,
    dataType: p.dataType,
    required: p.required,
    defaultValue: p.defaultValue,
  };
}

function entityTypeDefToExport(etDef: EntityTypeDef): Row {
  return {
    key: etDef.key,
    displayName: etDef.displayName,
    description: etDef.description,
    nameProperty: etDef.nameProperty,
    properties: Object.values(etDef.properties).map(propertyToExport),
  };
}

function relationTypeDefToExport(rtDef: RelationTypeDef): Row {
  return {
    key: rtDef.key,
    displayName: rtDef.displayName,
    description: rtDef.description,
    fromEntityTypeKey: rtDef.fromEntityTypeKey,
    toEntityTypeKey: rtDef.toEntityTypeKey,
    parent: rtDef.parent,
    properties: Object.values(rtDef.properties).map(propertyToExport),
  };
}

/** The whole scoped schema in one response. */
export async function getLensSchema(lensKey: string, store: RuntimeStore): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const cache = loaded.scoped;
  return {
    lens: {
      key: cache.lensKey,
      name: cache.lensName,
      description: cache.lensDescription,
    },
    entityTypes: Object.values(cache.entityTypes).map(entityTypeDefToExport),
    relationTypes: Object.values(cache.relationTypes).map(relationTypeDefToExport),
  };
}

export async function listEntityTypes(lensKey: string, store: RuntimeStore): Promise<Row[]> {
  const loaded = await loadSchema(lensKey, store);
  return Object.values(loaded.scoped.entityTypes).map(entityTypeDefToExport);
}

/** Out-of-scope reads answer not-found, indistinguishably from nonexistent. */
export async function getEntityType(
  lensKey: string,
  key: string,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const etDef = loaded.scoped.entityTypes[key];
  if (etDef === undefined) {
    throw new NotFoundError(`Entity type '${key}' not found`);
  }
  return entityTypeDefToExport(etDef);
}

export async function listRelationTypes(
  lensKey: string,
  store: RuntimeStore,
): Promise<Row[]> {
  const loaded = await loadSchema(lensKey, store);
  return Object.values(loaded.scoped.relationTypes).map(relationTypeDefToExport);
}

export async function getRelationType(
  lensKey: string,
  key: string,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const rtDef = loaded.scoped.relationTypes[key];
  if (rtDef === undefined) {
    throw new NotFoundError(`Relation type '${key}' not found`);
  }
  return relationTypeDefToExport(rtDef);
}

// ---------------------------------------------------------------------------
// Entity instance CRUD
// ---------------------------------------------------------------------------

export interface PaginatedResult {
  items: Row[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * The endpoint check of a relation write: the entity exists and has the
 * declared type, against the FULL schema, not the lens, so a narrow lens
 * cannot create an edge that is invalid under a wider one. The defs
 * passed along describe the declared type — the row decoder's best guide
 * for the entity the id is expected to name. Null when the end is fine.
 */
async function endpointError(
  store: RuntimeStore,
  fullSchema: SchemaCacheValue,
  entityId: string,
  expectedType: string,
  label: "Source" | "Target" | "Parent",
): Promise<string | null> {
  const entity = await store.getEntityById(entityId, fullSchema.entityTypes[expectedType]?.properties ?? {});
  if (entity === null) {
    return `${label} entity '${entityId}' not found`;
  }
  if (entity._entityTypeKey !== expectedType) {
    return `${label} entity type mismatch: expected '${expectedType}', got '${entity._entityTypeKey}'`;
  }
  return null;
}

/**
 * Create an entity (`prepareCreateEntity`): validate against the SCOPED
 * properties, apply defaults from the FULL schema, maintain document
 * length bookkeeping, filter the response to the lens.
 *
 * With `parentRelation`, the entity is created together with the relation
 * that names its parent: one 422 carries the faults of both, and both rows
 * are written in one transaction. Its parent end is checked here as a
 * relation create checks its ends (`endpointError`), under
 * `parentRelation.parentId`. The response is the entity alone, as without
 * it. On an anchored call, an entity of the anchor's hierarchy must name a
 * covered parent this way (`AnchorGuard.checkCreate`); its faults join the
 * others.
 */
export async function createEntity(
  lensKey: string,
  entityTypeKey: string,
  body: Row,
  store: RuntimeStore,
  parentRelation: ParentRelationInput | null = null,
  anchorKey: string | null = null,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const scopedEt = scopedEntityType(loaded, entityTypeKey);
  const guard = await AnchorGuard.open(anchorKey, loaded, store);

  const { errors, write } = prepareCreateEntity(loaded, entityTypeKey, body, parentRelation, {
    entityId: randomUUID(),
    relationId: randomUUID(),
  });
  if (write.parent !== null) {
    const { parentId, parentType } = write.parent;
    const parentError = await endpointError(store, loaded.full, parentId, parentType, "Parent");
    if (parentError !== null) {
      errors["parentRelation.parentId"] = parentError;
    }
  }
  await guard?.checkCreate(entityTypeKey, parentRelation, errors);
  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Instance validation failed", { fields: errors });
  }

  const e = write.entity;
  const entitySearch = await searchPlan(store, e.change);
  if (write.parent === null) {
    const entity = await store.createEntity(e.entityTypeKey, e.entityId, e.properties, e.propertyDefs, entitySearch);
    return filterEntityProperties(entity, scopedEt);
  }

  const r = write.parent.relation;
  const { entity } = await store.createEntityWithParent(
    {
      entityTypeKey: e.entityTypeKey,
      entityId: e.entityId,
      properties: e.properties,
      propertyDefs: e.propertyDefs,
      search: entitySearch,
    },
    {
      relationTypeKey: r.relationTypeKey,
      relationId: r.relationId,
      fromEntityId: r.fromEntityId,
      toEntityId: r.toEntityId,
      properties: r.properties,
      propertyDefs: r.propertyDefs,
      search: await searchPlan(store, r.change),
    },
  );
  return filterEntityProperties(entity, scopedEt);
}

export async function listEntities(
  lensKey: string,
  entityTypeKey: string,
  limit: number,
  offset: number,
  sort: string,
  order: string,
  q: string | null,
  filters: Record<string, string>,
  store: RuntimeStore,
  fields?: string[] | null,
): Promise<PaginatedResult> {
  const loaded = await loadSchema(lensKey, store);
  const scopedEt = loaded.scoped.entityTypes[entityTypeKey];
  if (scopedEt === undefined) {
    throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  }

  // The free-text term crosses the port as-is, so it carries the same
  // NUL rejection stored strings do.
  if (q !== null) {
    try {
      assertNoNulCharacter(q, "q");
    } catch (error) {
      if (!(error instanceof CoercionError)) throw error;
      throw new ValidationError(error.message);
    }
  }

  // The free-text term matches over in-scope string properties; when there
  // are none it is silently ignored (the adapter adds no clause).
  const stringProps = Object.values(scopedEt.properties)
    .filter((p) => p.dataType === "string")
    .map((p) => p.key);

  const sortField = validateSortField(sort, scopedEt.properties);
  const conditions = parseFilterConditions(filters, scopedEt.properties, entityTypeKey, {
    pathSchema: loaded.scoped,
  });

  const [rawItems, total] = await store.listEntities(
    entityTypeKey,
    scopedEt.properties,
    conditions,
    q,
    stringProps,
    sortField,
    order,
    limit,
    offset,
  );

  let items = rawItems.map((e) => filterEntityProperties(e, scopedEt, fields));
  if (fields !== null && fields !== undefined) {
    items = items.map((e) => applyFieldProjection(e, fields, ENTITY_ALWAYS_FIELDS));
  }

  return { items, total, limit, offset };
}

export async function getEntity(
  lensKey: string,
  entityTypeKey: string,
  entityId: string,
  store: RuntimeStore,
  fields?: string[] | null,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const scopedEt = loaded.scoped.entityTypes[entityTypeKey];
  if (scopedEt === undefined) {
    throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  }

  const entity = await store.getEntity(entityTypeKey, entityId);
  if (entity === null) {
    throw new NotFoundError(`Entity '${entityId}' not found`);
  }

  const filtered = filterEntityProperties(entity, scopedEt, fields);
  return applyFieldProjection(filtered, fields, ENTITY_ALWAYS_FIELDS);
}

/** One step of an entity's path. `name` is the value of the type's name
 * property; null when it is unset or the lens hides it. */
export interface PathStep {
  type: string;
  id: string;
  name: string | null;
}

/**
 * The entity's path through the lens: root first, ending with the entity.
 * The walk follows every parent relation of the FULL schema; the lens then
 * cuts it, so the path starts below the nearest ancestor whose type the
 * lens hides and never names a hidden entity. A root's path is itself
 * alone. A hidden type or an unknown entity is not found, as `getEntity`.
 *
 * On data the accepted race left with two parents the walk is no chain:
 * the path then lists every visible ancestor the walk reaches, in the
 * walk's deterministic order reversed, and reports no error.
 *
 * Two statements: the walk, then one batch read for the names.
 */
export async function getPath(
  lensKey: string,
  entityTypeKey: string,
  entityId: string,
  store: RuntimeStore,
): Promise<PathStep[]> {
  const loaded = await loadSchema(lensKey, store);
  const visibleTypes = loaded.scoped.entityTypes;
  if (!(entityTypeKey in visibleTypes)) {
    throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  }

  // Nearest first: keep the ancestors below the first hidden one.
  const ancestors = await store.getAncestors(entityId, parentReadings(loaded.full));
  const hidden = ancestors.findIndex((ancestor) => !(ancestor.type in visibleTypes));
  const visible = hidden === -1 ? ancestors : ancestors.slice(0, hidden);
  const steps = [...visible.reverse(), { type: entityTypeKey, id: entityId }];

  // The name property is a string, which decodes without definitions.
  const rows = await store.getEntitiesByIds(steps.map((step) => step.id), {});
  const entity = rows[entityId];
  if (entity === undefined || entity._entityTypeKey !== entityTypeKey) {
    throw new NotFoundError(`Entity '${entityId}' not found`);
  }

  return steps.map((step) => {
    const nameProperty = visibleTypes[step.type]?.nameProperty ?? null;
    const value = nameProperty === null ? undefined : rows[step.id]?.[nameProperty];
    return { type: step.type, id: step.id, name: typeof value === "string" ? value : null };
  });
}

/**
 * Partial update (`prepareUpdateEntity`): validate against the scoped
 * properties, NO default re-application. Null removes an optional property
 * (and is rejected on a required one); a payload that changes nothing
 * returns the current state without advancing `_updatedAt`. On an anchored
 * call, an entity of the anchor's hierarchy outside the anchored subtree is
 * refused on `entityId`.
 */
export async function updateEntity(
  lensKey: string,
  entityTypeKey: string,
  entityId: string,
  body: Row,
  store: RuntimeStore,
  anchorKey: string | null = null,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const scopedEt = scopedEntityType(loaded, entityTypeKey);
  const guard = await AnchorGuard.open(anchorKey, loaded, store);

  const { errors, write } = prepareUpdateEntity(loaded, entityTypeKey, entityId, body);
  const outside = (await guard?.entityError(entityTypeKey, entityId)) ?? null;
  if (outside !== null) {
    errors.entityId = outside;
  }
  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Instance validation failed", { fields: errors });
  }

  if (write === null) {
    return getEntity(lensKey, entityTypeKey, entityId, store);
  }

  const entity = await store.updateEntity(
    write.entityTypeKey,
    write.entityId,
    write.setProperties,
    write.removeProperties,
    write.propertyDefs,
    await searchPlan(store, write.change),
  );
  if (entity === null) {
    throw new NotFoundError(`Entity '${entityId}' not found`);
  }

  return filterEntityProperties(entity, scopedEt);
}

/**
 * Delete an entity, every relation attached to it in either direction —
 * including relations whose type the lens cannot see — and its search
 * data. Wherever the ontology flags a parent relation, only a leaf may go:
 * an entity with children over any parent relation of the full schema is
 * refused (409), through every lens, before the delete. Otherwise the
 * cascade is silent: nothing warns, nothing refuses. On an anchored call
 * the guard refuses first (`AnchorGuard.checkDelete`): outside the
 * anchored subtree, then anchored (422 on `entityId`); "has children"
 * comes last.
 */
export async function deleteEntity(
  lensKey: string,
  entityTypeKey: string,
  entityId: string,
  store: RuntimeStore,
  anchorKey: string | null = null,
): Promise<void> {
  const loaded = await loadSchema(lensKey, store);
  scopedEntityType(loaded, entityTypeKey);
  const guard = await AnchorGuard.open(anchorKey, loaded, store);

  const write = prepareDeleteEntity(loaded, entityTypeKey, entityId);
  const readings = parentReadings(loaded.full);
  const flagged = Object.keys(readings).length > 0;
  // A missing entity stays not-found, whatever its id has below it.
  if (flagged && (await store.getEntity(entityTypeKey, entityId)) === null) {
    throw new NotFoundError(`Entity '${entityId}' not found`);
  }
  await guard?.checkDelete(entityTypeKey, entityId);
  if (flagged && (await store.hasChildren(entityId, readings))) {
    throw new ConflictError(HAS_CHILDREN_MESSAGE);
  }

  const deleted = await store.deleteEntity(write.entityTypeKey, write.entityId, await searchPlan(store, write.change));
  if (!deleted) {
    throw new NotFoundError(`Entity '${entityId}' not found`);
  }
}

// ---------------------------------------------------------------------------
// Document properties: chunk sync, slice read, partial writes
// ---------------------------------------------------------------------------

/**
 * Resolve a scoped document property and return its current value plus the
 * loaded schema. Raises NotFoundError for unknown/out-of-scope types or
 * properties, non-document properties, and missing entities. An unset value
 * reads as "".
 */
async function loadDocumentValue(
  lensKey: string,
  entityTypeKey: string,
  entityId: string,
  propertyKey: string,
  store: RuntimeStore,
): Promise<{ value: string; loaded: Awaited<ReturnType<typeof loadSchema>> }> {
  const loaded = await loadSchema(lensKey, store);
  const scopedEt = loaded.scoped.entityTypes[entityTypeKey];
  if (scopedEt === undefined) {
    throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  }

  const propDef = scopedEt.properties[propertyKey];
  if (propDef === undefined || propDef.dataType !== "document") {
    throw new NotFoundError(
      `Document property '${propertyKey}' not found on entity type '${entityTypeKey}'`,
    );
  }

  const entity = await store.getEntity(entityTypeKey, entityId);
  if (entity === null) {
    throw new NotFoundError(`Entity '${entityId}' not found`);
  }

  const value = entity[propertyKey];
  return { value: typeof value === "string" ? value : "", loaded };
}

/**
 * Read (a slice of) a document property value. `offset`/`limit` are
 * character-based (code points); without them the full document is
 * returned. Slicing is forgiving: past-end offsets yield empty content,
 * over-long limits are truncated.
 */
export async function getDocument(
  lensKey: string,
  entityTypeKey: string,
  entityId: string,
  propertyKey: string,
  offset: number,
  limit: number | null,
  store: RuntimeStore,
): Promise<Row> {
  const { value } = await loadDocumentValue(
    lensKey,
    entityTypeKey,
    entityId,
    propertyKey,
    store,
  );

  const content = limit === null ? cpSlice(value, offset) : cpSlice(value, offset, offset + limit);

  return {
    propertyKey,
    content,
    offset,
    length: cpLength(content),
    totalLength: cpLength(value),
  };
}

/** One partial-write operation on a document property. `str_replace` needs
 * `oldString`/`newString`; `replace_range` needs `offset`/`length`/`content`
 * (plus optional `expect` as a guard against stale offsets). Per-op field
 * validation happens in the service, not in the request schema. */
export interface DocumentEditBody {
  op: "str_replace" | "replace_range";
  oldString?: string | null | undefined;
  newString?: string | null | undefined;
  replaceAll?: boolean | undefined;
  offset?: number | null | undefined;
  length?: number | null | undefined;
  content?: string | null | undefined;
  expect?: string | null | undefined;
}

// Characters returned around an edit so callers can verify without re-reading.
const EDIT_CONTEXT_CHARS = 200;

/** Returns [newValue, editOffset, editLength, replacements]. */
function applyStrReplace(value: string, body: DocumentEditBody): [string, number, number, number] {
  const old = body.oldString ?? null;
  const replacement = body.newString ?? null;
  if (!old) {
    throw new ValidationError("oldString must be a non-empty string");
  }
  if (replacement === null) {
    throw new ValidationError("newString is required for str_replace");
  }
  if (old === replacement) {
    throw new ValidationError("newString must differ from oldString");
  }

  const count = countOccurrences(value, old);
  if (count === 0) {
    throw new ValidationError("oldString not found in document");
  }
  if (count > 1 && !body.replaceAll) {
    throw new ValidationError(
      `oldString matches ${count} times — provide a longer, unique string ` +
        "or set replaceAll to true",
    );
  }

  const first = cpIndexOf(value, old);
  if (body.replaceAll) {
    return [value.replaceAll(old, replacement), first, cpLength(replacement), count];
  }
  const firstUnits = value.indexOf(old);
  return [
    value.slice(0, firstUnits) + replacement + value.slice(firstUnits + old.length),
    first,
    cpLength(replacement),
    1,
  ];
}

/** Returns [newValue, editOffset, editLength, replacements]. */
function applyReplaceRange(
  value: string,
  body: DocumentEditBody,
): [string, number, number, number] {
  const offset = body.offset ?? null;
  const length = body.length ?? null;
  const content = body.content ?? null;
  if (offset === null || length === null || content === null) {
    throw new ValidationError("replace_range requires offset, length, and content");
  }
  if (offset < 0 || length < 0) {
    throw new ValidationError("offset and length must be >= 0");
  }
  const total = cpLength(value);
  if (offset > total) {
    throw new ValidationError(`offset ${offset} is beyond the document end (${total} chars)`);
  }
  if (offset + length > total) {
    throw new ValidationError(
      `range [${offset}, ${offset + length}) exceeds the document end (${total} chars)`,
    );
  }
  const expect = body.expect ?? null;
  if (expect !== null && cpSlice(value, offset, offset + length) !== expect) {
    throw new ConflictError(
      `expect mismatch at [${offset}, ${offset + length}) — the document ` +
        "changed since it was read; re-read before editing",
    );
  }
  return [
    cpSlice(value, 0, offset) + content + cpSlice(value, offset + length),
    offset,
    cpLength(content),
    1,
  ];
}

/**
 * Apply one partial-write operation to a document property.
 *
 * `str_replace` swaps an exact, unique string (or all occurrences with
 * `replaceAll`); `replace_range` overwrites the character range
 * `[offset, offset+length)` with `content` (insert with length 0, append
 * at `offset == totalLength`). The changed value is persisted whole and the
 * property's search data follows: the search indices queue its passages.
 * On an anchored call, an entity of the anchor's hierarchy outside the
 * anchored subtree is refused on `entityId`.
 */
export async function editDocument(
  lensKey: string,
  entityTypeKey: string,
  entityId: string,
  propertyKey: string,
  body: DocumentEditBody,
  store: RuntimeStore,
  anchorKey: string | null = null,
): Promise<Row> {
  const { value, loaded } = await loadDocumentValue(
    lensKey,
    entityTypeKey,
    entityId,
    propertyKey,
    store,
  );
  await (await AnchorGuard.open(anchorKey, loaded, store))?.checkEntity(entityTypeKey, entityId);

  const [newValue, offset, length, replacements] =
    body.op === "str_replace" ? applyStrReplace(value, body) : applyReplaceRange(value, body);

  const setProps: Row = {
    [propertyKey]: newValue,
    [docLengthKey(propertyKey)]: cpLength(newValue),
  };
  const fullEt = loaded.full.entityTypes[entityTypeKey];
  const entity = await store.updateEntity(
    entityTypeKey,
    entityId,
    setProps,
    [],
    fullEt?.properties ?? {},
    await searchPlan(store, {
      kind: "entityUpdated",
      entityType: entityTypeKey,
      entityId,
      changedKeys: [propertyKey],
    }),
  );
  if (entity === null) {
    throw new NotFoundError(`Entity '${entityId}' not found`);
  }

  const contextStart = Math.max(0, offset - EDIT_CONTEXT_CHARS);
  const contextEnd = Math.min(cpLength(newValue), offset + length + EDIT_CONTEXT_CHARS);
  return {
    propertyKey,
    totalLength: cpLength(newValue),
    editedRange: { offset, length },
    replacements,
    context: cpSlice(newValue, contextStart, contextEnd),
    contextOffset: contextStart,
  };
}

// ---------------------------------------------------------------------------
// Relation instance CRUD
// ---------------------------------------------------------------------------

/**
 * The parent rules for a new relation of a parent relation type, checked
 * once, here, against the cached FULL schema — across every parent
 * relation, whatever the lens shows. No adapter re-check and no lock: the
 * rare race of two concurrent writes is accepted. Faults join the other
 * field errors and never name the existing parent:
 *
 * - the child end already has a parent ("at most one parent");
 * - the parent end is the child or one of its descendants (a cycle; a
 *   self-loop is one), found as the child among the parent's ancestors.
 *
 * An end that already carries an endpoint error (not found, wrong type)
 * is not checked.
 */
async function checkParentRules(
  parentEnd: ParentEnd,
  fromEntityId: string,
  toEntityId: string,
  fullSchema: SchemaCacheValue,
  errors: Record<string, string>,
  store: RuntimeStore,
): Promise<void> {
  const [childField, childId, parentField, parentId] =
    parentEnd === "source"
      ? (["toEntityId", toEntityId, "fromEntityId", fromEntityId] as const)
      : (["fromEntityId", fromEntityId, "toEntityId", toEntityId] as const);
  const childFound = !(childField in errors);
  const parentFound = !(parentField in errors);
  const readings = parentReadings(fullSchema);

  if (childFound && (await store.getAncestors(childId, readings)).length > 0) {
    errors[childField] = `Entity '${childId}' already has a parent`;
  }
  if (childFound && parentFound) {
    const closesCycle =
      parentId === childId ||
      (await store.getAncestors(parentId, readings)).some((ancestor) => ancestor.id === childId);
    if (closesCycle) {
      errors[parentField] = `Entity '${parentId}' cannot be the parent: this would close a cycle`;
    }
  }
}

/**
 * Create a relation (`prepareCreateRelation`): validate properties against
 * the SCOPED definitions, apply defaults from the FULL schema, and check
 * that both endpoints exist and their entity types equal the relation
 * type's declared source/target — checked against the FULL schema, not the
 * lens, so a narrow lens cannot create an edge that is invalid under a
 * wider one. For a parent relation
 * type the parent rules follow (`checkParentRules`). On an anchored call
 * the guard checks the ends and refuses a standalone parent relation of the
 * anchor's hierarchy (`AnchorGuard.checkRelationCreate`). Endpoint, guard
 * and rule errors are collected alongside property errors in ONE response.
 */
export async function createRelation(
  lensKey: string,
  relationTypeKey: string,
  fromEntityId: string,
  toEntityId: string,
  userProps: Row,
  store: RuntimeStore,
  anchorKey: string | null = null,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const scopedRt = scopedRelationType(loaded, relationTypeKey);
  const guard = await AnchorGuard.open(anchorKey, loaded, store);

  const { errors, write } = prepareCreateRelation(
    loaded,
    relationTypeKey,
    fromEntityId,
    toEntityId,
    userProps,
    randomUUID(),
  );

  // Endpoint validation against the FULL schema's declared source/target.
  const fullRtForValidation = loaded.full.relationTypes[relationTypeKey] ?? scopedRt;
  const fromError = await endpointError(
    store,
    loaded.full,
    fromEntityId,
    fullRtForValidation.fromEntityTypeKey,
    "Source",
  );
  if (fromError !== null) {
    errors.fromEntityId = fromError;
  }
  const toError = await endpointError(store, loaded.full, toEntityId, fullRtForValidation.toEntityTypeKey, "Target");
  if (toError !== null) {
    errors.toEntityId = toError;
  }

  await guard?.checkRelationCreate(fullRtForValidation, fromEntityId, toEntityId, errors);

  if (fullRtForValidation.parent !== null) {
    await checkParentRules(fullRtForValidation.parent, fromEntityId, toEntityId, loaded.full, errors, store);
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Instance validation failed", { fields: errors });
  }

  const relation = await store.createRelation(
    write.relationTypeKey,
    write.relationId,
    write.fromEntityId,
    write.toEntityId,
    write.properties,
    write.propertyDefs,
    await searchPlan(store, write.change),
  );

  return filterRelationProperties(relation, scopedRt);
}

export async function listRelations(
  lensKey: string,
  relationTypeKey: string,
  limit: number,
  offset: number,
  sort: string,
  order: string,
  fromEntityId: string | null,
  toEntityId: string | null,
  filters: Record<string, string>,
  store: RuntimeStore,
): Promise<PaginatedResult> {
  const loaded = await loadSchema(lensKey, store);
  const scopedRt = loaded.scoped.relationTypes[relationTypeKey];
  if (scopedRt === undefined) {
    throw new NotFoundError(`Relation type '${relationTypeKey}' not found`);
  }

  const sortField = validateSortField(sort, scopedRt.properties);
  const conditions = parseFilterConditions(filters, scopedRt.properties, relationTypeKey);

  const [rawItems, total] = await store.listRelations(
    relationTypeKey,
    scopedRt.properties,
    conditions,
    fromEntityId,
    toEntityId,
    sortField,
    order,
    limit,
    offset,
  );

  const items = rawItems.map((r) => filterRelationProperties(r, scopedRt));

  return { items, total, limit, offset };
}

export async function getRelation(
  lensKey: string,
  relationTypeKey: string,
  relationId: string,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const scopedRt = loaded.scoped.relationTypes[relationTypeKey];
  if (scopedRt === undefined) {
    throw new NotFoundError(`Relation type '${relationTypeKey}' not found`);
  }

  const relation = await store.getRelation(relationTypeKey, relationId);
  if (relation === null) {
    throw new NotFoundError(`Relation '${relationId}' not found`);
  }
  return filterRelationProperties(relation, scopedRt);
}

/**
 * Partial update of relation properties (`prepareUpdateRelation`).
 * ENDPOINTS ARE IMMUTABLE: payload keys `fromEntityId` / `toEntityId` are
 * dropped SILENTLY — no error — and properties in the same payload still
 * apply. On an anchored call the guard may refuse it on `relationId`
 * (`AnchorGuard.relationError`).
 */
export async function updateRelation(
  lensKey: string,
  relationTypeKey: string,
  relationId: string,
  body: Row,
  store: RuntimeStore,
  anchorKey: string | null = null,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const scopedRt = scopedRelationType(loaded, relationTypeKey);
  const guard = await AnchorGuard.open(anchorKey, loaded, store);

  const { errors, write } = prepareUpdateRelation(loaded, relationTypeKey, relationId, body);
  const refused =
    (await guard?.relationError(loaded.full.relationTypes[relationTypeKey] ?? scopedRt, relationId, "update")) ?? null;
  if (refused !== null) {
    errors.relationId = refused;
  }
  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Instance validation failed", { fields: errors });
  }

  if (write === null) {
    return getRelation(lensKey, relationTypeKey, relationId, store);
  }

  const relation = await store.updateRelation(
    write.relationTypeKey,
    write.relationId,
    write.setProperties,
    write.removeProperties,
    write.propertyDefs,
    await searchPlan(store, write.change),
  );
  if (relation === null) {
    throw new NotFoundError(`Relation '${relationId}' not found`);
  }
  return filterRelationProperties(relation, scopedRt);
}

/** Delete a relation; neither endpoint is touched. On an anchored call the
 * guard may refuse it on `relationId` (`AnchorGuard.checkRelationDelete`). */
export async function deleteRelation(
  lensKey: string,
  relationTypeKey: string,
  relationId: string,
  store: RuntimeStore,
  anchorKey: string | null = null,
): Promise<void> {
  const loaded = await loadSchema(lensKey, store);
  const scopedRt = scopedRelationType(loaded, relationTypeKey);
  const guard = await AnchorGuard.open(anchorKey, loaded, store);
  await guard?.checkRelationDelete(loaded.full.relationTypes[relationTypeKey] ?? scopedRt, relationId);

  const write = prepareDeleteRelation(loaded, relationTypeKey, relationId);
  const deleted = await store.deleteRelation(
    write.relationTypeKey,
    write.relationId,
    await searchPlan(store, write.change),
  );
  if (!deleted) {
    throw new NotFoundError(`Relation '${relationId}' not found`);
  }
}

// ---------------------------------------------------------------------------
// Graph traversal
// ---------------------------------------------------------------------------

export interface NeighborhoodResult {
  entity: Row;
  neighbors: Row[];
}

/**
 * One entity plus its immediate neighbourhood. Relations whose type the
 * lens does not expose are dropped together with their neighbour. A
 * neighbour is filtered to the lens only when its own entity type is in
 * scope — an out-of-scope neighbour escapes property stripping (the
 * documented leak), though its document values are still stubbed.
 */
export async function getNeighbors(
  lensKey: string,
  entityTypeKey: string,
  entityId: string,
  direction: string,
  relationTypeKey: string | null,
  limit: number,
  store: RuntimeStore,
  fields?: string[] | null,
  relationFields?: string[] | null,
): Promise<NeighborhoodResult> {
  const loaded = await loadSchema(lensKey, store);
  const scopedEt = loaded.scoped.entityTypes[entityTypeKey];
  if (scopedEt === undefined) {
    throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  }

  let entity = await store.getEntity(entityTypeKey, entityId);
  if (entity === null) {
    throw new NotFoundError(`Entity '${entityId}' not found`);
  }

  // Per-type-key defs for row decoding, from the FULL schema — neighbours
  // and their relations may be of types the lens does not expose. Relation
  // defs go in first; entity defs shadow them on a shared type key.
  const propertyDefsByType: Record<string, Record<string, PropertyDef>> = {};
  for (const [typeKey, rtDef] of Object.entries(loaded.full.relationTypes)) {
    propertyDefsByType[typeKey] = { ...rtDef.properties };
  }
  for (const [typeKey, etDef] of Object.entries(loaded.full.entityTypes)) {
    const defs = (propertyDefsByType[typeKey] ??= {});
    Object.assign(defs, etDef.properties);
  }

  const neighbors = await store.getNeighbors(
    entityId,
    direction,
    relationTypeKey,
    limit,
    propertyDefsByType,
  );

  // Filter neighbors by scoped relation types.
  const filteredNeighbors: Row[] = [];
  for (const n of neighbors) {
    const rel = n.relation as Row;
    const rtKey = rel._relationTypeKey as string | undefined;
    if (rtKey && rtKey in loaded.scoped.relationTypes) {
      const scopedRt = loaded.scoped.relationTypes[rtKey]!;
      n.relation = filterRelationProperties(rel, scopedRt);
      // Filter neighbor entity properties only when its own type is in scope.
      const neighborEntity = n.entity as Row;
      const neighborEtKey = neighborEntity._entityTypeKey as string | undefined;
      if (neighborEtKey && neighborEtKey in loaded.scoped.entityTypes) {
        n.entity = filterEntityProperties(
          neighborEntity,
          loaded.scoped.entityTypes[neighborEtKey]!,
          fields,
        );
      } else if (neighborEtKey && neighborEtKey in loaded.full.entityTypes) {
        // Type not in scope — still stub document values (never inline).
        n.entity = stubDocumentProperties(
          neighborEntity,
          loaded.full.entityTypes[neighborEtKey]!.properties,
          fields,
        );
      }
      filteredNeighbors.push(n);
    } else if (!rtKey) {
      filteredNeighbors.push(n);
    }
  }

  // Filter the centre entity.
  entity = filterEntityProperties(entity, scopedEt, fields);

  if (fields !== null && fields !== undefined) {
    entity = applyFieldProjection(entity, fields, ENTITY_ALWAYS_FIELDS);
    for (const n of filteredNeighbors) {
      n.entity = applyFieldProjection(n.entity as Row, fields, ENTITY_NEIGHBOR_ALWAYS_FIELDS);
    }
  }
  if (relationFields !== null && relationFields !== undefined) {
    for (const n of filteredNeighbors) {
      n.relation = applyFieldProjection(n.relation as Row, relationFields, RELATION_ALWAYS_FIELDS);
    }
  }

  return { entity, neighbors: filteredNeighbors };
}

// ---------------------------------------------------------------------------
// Semantic search
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// OQL query execution
// ---------------------------------------------------------------------------

/**
 * Validate, compile, and execute a read-only OQL query.
 *
 * Returns `{columns, results}` with properties filtered to the scoped
 * lens schema. Parsing and validation happen here, above the port;
 * the adapter compiles the validated query to its native dialect at
 * execution time. Ad-hoc queries run with NO parameter values —
 * placeholders parse, but binding is a saved-query concern.
 */
export async function executeQuery(
  lensKey: string,
  query: string,
  store: RuntimeStore,
): Promise<{ columns: string[]; results: Row[] }> {
  const loaded = await loadSchema(lensKey, store);
  const scoped = loaded.scoped;

  // Map variables → schema keys (uses original type keys).
  const varMap = getReturnVariables(query, scoped);

  // Validate against the scoped schema; the adapter compiles the
  // validated query to its native dialect at execution time.
  const validated = parseAndValidate(query, scoped);

  const [columns, rows] = await store.executeOql(validated);

  // Post-process: filter out-of-scope properties and stub document values.
  postprocessQueryRows(rows, varMap, scoped);

  return { columns, results: rows };
}

function isPlainObject(value: unknown): value is Row {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/**
 * Filter out-of-scope properties and stub document values (in place).
 *
 * Node/relationship maps are stripped to scoped properties with document
 * values stubbed — per column, exactly as a read result is
 * (`docs/capabilities/ontology-lenses.md#what-scoping-cuts`). Scalar
 * columns of the form `var.property` that reference a document property
 * are stubbed as well; an ALIASED projection of a document property is
 * not of that form and returns the full text — the documented exception.
 */
function postprocessQueryRows(
  rows: Row[],
  varMap: Map<string, string | null>,
  scoped: SchemaCacheValue,
): void {
  for (const row of rows) {
    for (const [col, value] of Object.entries(row)) {
      if (isPlainObject(value)) {
        const typeKey = resolveTypeKeyForValue(col, value, varMap, scoped);
        if (typeKey === null) {
          continue;
        }
        row[col] = stripOutOfScopeProps(value, typeKey, scoped);
      } else if (typeof value === "string" && col.includes(".")) {
        // Scalar projection like `RETURN p.bio` — stub document values.
        const dot = col.indexOf(".");
        const variable = col.slice(0, dot).trim();
        const prop = col.slice(dot + 1).trim();
        const typeKey = varMap.get(variable);
        if (typeKey === null || typeKey === undefined) {
          continue;
        }
        const etDef = scoped.entityTypes[typeKey];
        if (etDef === undefined) {
          continue;
        }
        const propDef = etDef.properties[prop];
        if (propDef !== undefined && propDef.dataType === "document") {
          row[col] = { document: true, length: cpLength(value) };
        }
      }
    }
  }
}

/** Figure out the schema type key for a map returned by the store. */
function resolveTypeKeyForValue(
  column: string,
  value: Row,
  varMap: Map<string, string | null>,
  schema: SchemaCacheValue,
): string | null {
  // If the column is a known variable, use the pre-built mapping.
  if (varMap.has(column)) {
    return varMap.get(column)!;
  }
  // Fallback: inspect _entityTypeKey or _relationTypeKey in the value.
  const etk = value._entityTypeKey;
  if (typeof etk === "string" && etk in schema.entityTypes) {
    return etk;
  }
  const rtk = value._relationTypeKey;
  if (typeof rtk === "string" && rtk in schema.relationTypes) {
    return rtk;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Saved-query execution
// ---------------------------------------------------------------------------

const BINDING_RE = /^\{\{(\w+)\.(\w+)\}\}$/;
const PARAM_REF_RE = /\$([a-zA-Z_]\w*)/g;

/** Render a list the way error messages spell one: `['a', 'b']`. */
function pyList(items: string[]): string {
  return `[${items.map((item) => `'${item}'`).join(", ")}]`;
}

/**
 * Resolve binding expressions against earlier step outputs: `fieldName`
 * collected from every row IN ROW ORDER into a flat list. A row lacking
 * the field is skipped; an empty list is not an error and flows on.
 */
export function resolveBindings(
  bindings: Record<string, string>,
  stepResults: Record<string, Row[]>,
): Record<string, unknown[]> {
  const resolved: Record<string, unknown[]> = {};
  for (const [paramName, expr] of Object.entries(bindings)) {
    const match = BINDING_RE.exec(expr);
    if (!match) {
      throw new ValidationError(`Invalid binding expression: ${expr}`);
    }
    const stepName = match[1]!;
    const fieldName = match[2]!;
    const rows = stepResults[stepName] ?? [];
    resolved[paramName] = rows.filter((row) => fieldName in row).map((row) => row[fieldName]);
  }
  return resolved;
}

/** Replace `$name` references textually; an unmatched `$name` is left in
 * the text verbatim. */
export function substituteParams(template: string, params: Row): string {
  return template.replace(PARAM_REF_RE, (whole, name: string) =>
    name in params ? valueToText(params[name]) : whole,
  );
}

/**
 * Execute a saved query pipeline by key with parameter values
 * (`docs/capabilities/saved-queries.md#execution`): exact parameter match,
 * strict coercion (collect-all), steps in order, bindings resolved before
 * each step, the LAST step's output returned post-processed like an ad-hoc
 * query. Nothing proactively invalidates stored pipelines — a schema
 * change surfaces here, at the next run.
 */
export async function executeSavedQuery(
  lensKey: string,
  queryKey: string,
  params: Row,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(lensKey, store);
  const config = loaded.savedQueries[queryKey];
  if (config === undefined) {
    throw new NotFoundError(`Saved query '${queryKey}' not found`);
  }

  // Exact match: no optionals, no defaults; missing and unrecognized
  // parameters are collected and reported together.
  const declaredNames = new Set(config.parameters.map((p) => p.name));
  const providedNames = new Set(Object.keys(params));
  const missing = [...declaredNames].filter((n) => !providedNames.has(n)).sort();
  const extra = [...providedNames].filter((n) => !declaredNames.has(n)).sort();
  const errors: string[] = [];
  if (missing.length > 0) {
    errors.push(`Missing required parameters: ${pyList(missing)}`);
  }
  if (extra.length > 0) {
    errors.push(`Unknown parameters: ${pyList(extra)}`);
  }
  if (errors.length > 0) {
    throw new ValidationError(`Parameter validation failed: ${errors.join("; ")}`, { errors });
  }

  // Coerce values to their declared types with the same strict coercion as
  // instance writes; all failures reported together, keyed by parameter.
  const coercedParams: Row = {};
  const coercionErrors: Record<string, string> = {};
  for (const paramDef of config.parameters) {
    try {
      coercedParams[paramDef.name] = coerceValue(
        params[paramDef.name],
        paramDef.dataType,
        paramDef.name,
      );
    } catch (exc) {
      if (exc instanceof CoercionError) {
        coercionErrors[paramDef.name] = exc.message;
      } else {
        throw exc;
      }
    }
  }
  if (Object.keys(coercionErrors).length > 0) {
    throw new ValidationError("Parameter type coercion failed", { fields: coercionErrors });
  }

  const scoped = loaded.scoped;
  const stepResults: Record<string, Row[]> = {};
  let lastOutput: Row = { columns: [], results: [] };

  for (const step of config.steps) {
    // Resolve bindings from previous step outputs.
    let resolvedBindings: Record<string, unknown> = {};
    if (step.bindings) {
      resolvedBindings = resolveBindings(step.bindings, stepResults);
    }

    if (step.type === "oql") {
      // Every coerced parameter is passed to every oql step, plus that
      // step's resolved bindings — the binding wins on a name collision.
      const queryParams = { ...coercedParams, ...resolvedBindings };

      const varMap = getReturnVariables(step.oql!, scoped);
      const validated = parseAndValidate(step.oql!, scoped);

      const [columns, rows] = await store.executeOql(validated, queryParams);

      // Post-process exactly like an ad-hoc query: strip out-of-scope
      // properties and stub document values.
      postprocessQueryRows(rows, varMap, scoped);

      stepResults[step.name] = rows;
      lastOutput = { columns, results: rows };
    } else if (step.type === "search") {
      // Bindings are resolved but IGNORED here — only declared parameters
      // reach the search text, textually substituted.
      const queryText = substituteParams(step.query!, coercedParams);

      const result = await search(lensKey, {
        query: queryText, type: step.entityTypeKey!, limit: step.limit || 10,
      }, store);
      const rows = result.hits.map((hit) => hit.entity);

      stepResults[step.name] = rows;
      lastOutput = { ...result };
    }
  }

  return lastOutput;
}

// ---------------------------------------------------------------------------
// Saved-query discovery
// ---------------------------------------------------------------------------

/** One saved query in the runtime listing's wire shape: absent step fields
 * are OMITTED, not serialized as null. */
function savedQueryToWire(sq: {
  key: string;
  name: string;
  description: string;
  steps: {
    name: string;
    type: string;
    oql?: string | null;
    entityTypeKey?: string | null;
    query?: string | null;
    limit?: number | null;
    bindings?: Record<string, string> | null;
  }[];
  parameters: { name: string; description: string; dataType: string }[];
}): Row {
  return {
    key: sq.key,
    name: sq.name,
    description: sq.description,
    steps: sq.steps.map((s) => ({
      name: s.name,
      type: s.type,
      ...(s.oql ? { oql: s.oql } : {}),
      ...(s.entityTypeKey ? { entityTypeKey: s.entityTypeKey } : {}),
      ...(s.query ? { query: s.query } : {}),
      ...(s.limit !== null && s.limit !== undefined ? { limit: s.limit } : {}),
      ...(s.bindings && Object.keys(s.bindings).length > 0 ? { bindings: s.bindings } : {}),
    })),
    parameters: sq.parameters.map((p) => ({
      name: p.name,
      description: p.description,
      dataType: p.dataType,
    })),
  };
}

/** The lens's saved queries, served FROM THE SCHEMA CACHE — the runtime
 * listing reflects the state of the process that answers it. */
export async function listSavedQueries(lensKey: string, store: RuntimeStore): Promise<Row[]> {
  const loaded = await loadSchema(lensKey, store);
  return Object.values(loaded.savedQueries).map(savedQueryToWire);
}

/**
 * Semantic search over saved-query DESCRIPTIONS — nothing else is
 * embedded. Returns key/name/description/parameters/score, never steps.
 * Requires an embedding provider (`details.code: FEATURE_DISABLED`).
 */
export async function searchSavedQueries(
  lensKey: string,
  query: string,
  limit: number,
  minScore: number | null,
  store: RuntimeStore,
): Promise<Row[]> {
  const provider = getEmbeddingProvider();
  if (!provider) {
    throw new ValidationError(
      "Semantic search requires EMBEDDING_PROVIDER to be configured",
      { code: "FEATURE_DISABLED" },
    );
  }

  const queryEmbedding = await provider.embed(query);
  if (queryEmbedding === null) {
    throw new ValidationError("Failed to generate embedding for search query");
  }

  const results = await store.searchSavedQueries(queryEmbedding, lensKey, limit, minScore);

  // Deserialize the stored parameters JSON for each hit.
  for (const r of results) {
    const paramsRaw = r.parameters ?? "[]";
    const paramsList = (
      typeof paramsRaw === "string" ? JSON.parse(paramsRaw) : (paramsRaw ?? [])
    ) as Row[];
    r.parameters = paramsList.map((p) => ({
      name: p.name,
      description: p.description,
      dataType: p.dataType,
    }));
  }

  return results;
}

/** Remove properties not in the scoped schema and stub documents. Unlike
 * entity reads, only the SYSTEM properties survive here — other
 * underscore-prefixed bookkeeping is stripped. */
function stripOutOfScopeProps(value: Row, typeKey: string, schema: SchemaCacheValue): Row {
  let allowed: Set<string>;
  let result = value;
  const etDef = schema.entityTypes[typeKey];
  const rtDef = schema.relationTypes[typeKey];
  if (etDef !== undefined) {
    allowed = new Set([...Object.keys(etDef.properties), ...SYSTEM_PROPERTIES]);
    // Stub document values before the helper `_doc_*_length` keys are stripped.
    result = stubDocumentProperties(value, etDef.properties);
  } else if (rtDef !== undefined) {
    allowed = new Set([...Object.keys(rtDef.properties), ...SYSTEM_PROPERTIES]);
  } else {
    return value;
  }
  for (const key of Object.keys(result)) {
    if (!allowed.has(key)) {
      delete result[key];
    }
  }
  return result;
}
