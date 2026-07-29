/**
 * Runtime service: schema introspection through a lens, and the entity
 * instance lifecycle with the validating write pipeline. Ported from the
 * entity portions of the Python reference (`runtime/service.py`); REST and
 * the runtime MCP server are two entrances to these same functions.
 *
 * The two contractual properties of the write pipeline
 * (`docs/architecture.md#request-lifecycle`):
 *
 * - ALL errors are collected — one rejected write names every offending
 *   field at once in `details.fields`.
 * - Writes validate against the LENS; defaults come from the FULL schema
 *   (`docs/decisions.md#behaviour`). A hidden property with a default is
 *   applied; a hidden property in the payload is an unknown property.
 */

import { randomUUID } from "node:crypto";

import { settings } from "../config.js";
import { CoercionError, coerceValue } from "../core/dataTypes.js";
import { getEmbeddingProvider } from "../core/embedding.js";
import { ConflictError, NotFoundError, ValidationError } from "../core/exceptions.js";
import { SYSTEM_PROPERTIES, getReturnVariables, parseAndValidate } from "../core/oql/index.js";
import type { RuntimeStore } from "../core/ports.js";
import { chunkDocument } from "./chunking.js";
import { cpIndexOf, cpLength, cpSlice, countOccurrences } from "./codePoints.js";
import {
  loadSchema,
  type EntityTypeDef,
  type PropertyDef,
  type RelationTypeDef,
  type SchemaCacheValue,
} from "./schemaCache.js";

type Row = Record<string, unknown>;

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

// ---------------------------------------------------------------------------
// Document properties (stub read model)
// ---------------------------------------------------------------------------

const DOC_LENGTH_PREFIX = "_doc_";
const DOC_LENGTH_SUFFIX = "_length";

/** Internal entity property storing a document property's character count. */
export function docLengthKey(propertyKey: string): string {
  return `${DOC_LENGTH_PREFIX}${propertyKey}${DOC_LENGTH_SUFFIX}`;
}

function documentPropertyKeys(propertyDefs: Record<string, PropertyDef>): Set<string> {
  const keys = new Set<string>();
  for (const [k, p] of Object.entries(propertyDefs)) {
    if (p.dataType === "document") {
      keys.add(k);
    }
  }
  return keys;
}

/**
 * Replace document property values with `{"document": true, "length": N}`
 * stubs. Internal `_doc_{key}_length` bookkeeping is consumed for the stub
 * length — measured from the value when missing — and removed from the
 * payload. Properties named in the `fields` projection keep their raw value.
 */
function stubDocumentProperties(
  entity: Row,
  propertyDefs: Record<string, PropertyDef>,
  fields?: string[] | null,
): Row {
  const requested = new Set(fields ?? []);

  const lengths: Record<string, unknown> = {};
  const result: Row = {};
  for (const [k, v] of Object.entries(entity)) {
    if (k.startsWith(DOC_LENGTH_PREFIX) && k.endsWith(DOC_LENGTH_SUFFIX)) {
      lengths[k.slice(DOC_LENGTH_PREFIX.length, k.length - DOC_LENGTH_SUFFIX.length)] = v;
      continue;
    }
    result[k] = v;
  }

  for (const key of documentPropertyKeys(propertyDefs)) {
    if (requested.has(key)) {
      continue; // raw value explicitly requested via fields projection
    }
    const value = result[key];
    if (value === null || value === undefined) {
      continue;
    }
    let length = lengths[key];
    if (length === null || length === undefined) {
      length = typeof value === "string" ? cpLength(value) : 0;
    }
    result[key] = { document: true, length };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Response property filtering and field projection
// ---------------------------------------------------------------------------

/** Filter entity properties to the scoped schema and stub document values. */
function filterEntityProperties(
  entity: Row,
  scopedEt: EntityTypeDef,
  fields?: string[] | null,
): Row {
  const filtered: Row = {};
  for (const [k, v] of Object.entries(entity)) {
    if (k.startsWith("_") || k in scopedEt.properties) {
      filtered[k] = v;
    }
  }
  return stubDocumentProperties(filtered, scopedEt.properties, fields);
}

const ENTITY_ALWAYS_FIELDS: ReadonlySet<string> = new Set(["_id"]);
const ENTITY_NEIGHBOR_ALWAYS_FIELDS: ReadonlySet<string> = new Set(["_id", "_entityTypeKey"]);
const RELATION_ALWAYS_FIELDS: ReadonlySet<string> = new Set([
  "_id",
  "_relationTypeKey",
  "direction",
]);

/** Filter relation properties to the scoped schema. Endpoint ids — the
 * documented exception to the underscore convention — and the computed
 * `direction` always survive. */
function filterRelationProperties(relation: Row, scopedRt: RelationTypeDef): Row {
  const filtered: Row = {};
  for (const [k, v] of Object.entries(relation)) {
    if (
      k.startsWith("_") ||
      k in scopedRt.properties ||
      k === "fromEntityId" ||
      k === "toEntityId" ||
      k === "direction"
    ) {
      filtered[k] = v;
    }
  }
  return filtered;
}

function applyFieldProjection(
  data: Row,
  fields: string[] | null | undefined,
  alwaysInclude: ReadonlySet<string>,
): Row {
  if (fields === null || fields === undefined) {
    return data;
  }
  const keep = new Set([...alwaysInclude, ...fields]);
  const result: Row = {};
  for (const [k, v] of Object.entries(data)) {
    if (keep.has(k)) {
      result[k] = v;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Filter / sort helpers (list endpoints)
// ---------------------------------------------------------------------------

/** Extract `filter.<key>` query parameters; repeated parameters keep the
 * last value, matching the Python router's `dict(request.query_params)`. */
export function parseFilters(queryParams: Record<string, unknown>): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const [paramName, value] of Object.entries(queryParams)) {
    if (paramName.startsWith("filter.")) {
      const filterKey = paramName.slice("filter.".length);
      const single = Array.isArray(value) ? value[value.length - 1] : value;
      filters[filterKey] = String(single);
    }
  }
  return filters;
}

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
    properties: Object.values(rtDef.properties).map(propertyToExport),
  };
}

/** The whole scoped schema in one response. */
export async function getFullSchema(ontologyKey: string, store: RuntimeStore): Promise<Row> {
  const loaded = await loadSchema(ontologyKey, store);
  const cache = loaded.scoped;
  return {
    ontology: {
      key: cache.ontologyKey,
      name: cache.ontologyName,
      description: cache.ontologyDescription,
      includes: null,
      aiAgents: [],
      savedQueries: [],
    },
    entityTypes: Object.values(cache.entityTypes).map(entityTypeDefToExport),
    relationTypes: Object.values(cache.relationTypes).map(relationTypeDefToExport),
  };
}

export async function listEntityTypes(ontologyKey: string, store: RuntimeStore): Promise<Row[]> {
  const loaded = await loadSchema(ontologyKey, store);
  return Object.values(loaded.scoped.entityTypes).map(entityTypeDefToExport);
}

/** Out-of-scope reads answer not-found, indistinguishably from nonexistent. */
export async function getEntityType(
  ontologyKey: string,
  key: string,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(ontologyKey, store);
  const etDef = loaded.scoped.entityTypes[key];
  if (etDef === undefined) {
    throw new NotFoundError(`Entity type '${key}' not found`);
  }
  return entityTypeDefToExport(etDef);
}

export async function listRelationTypes(
  ontologyKey: string,
  store: RuntimeStore,
): Promise<Row[]> {
  const loaded = await loadSchema(ontologyKey, store);
  return Object.values(loaded.scoped.relationTypes).map(relationTypeDefToExport);
}

export async function getRelationType(
  ontologyKey: string,
  key: string,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(ontologyKey, store);
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
 * Create an entity: validate against the SCOPED properties, apply defaults
 * from the FULL schema (a default that fails coercion here is skipped
 * silently — the second documented bad-default failure mode), maintain
 * document length bookkeeping, filter the response to the lens.
 */
export async function createEntity(
  ontologyKey: string,
  entityTypeKey: string,
  body: Row,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(ontologyKey, store);
  const scopedEt = loaded.scoped.entityTypes[entityTypeKey];
  if (scopedEt === undefined) {
    throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  }

  const [coerced, errors] = validateProperties(body, scopedEt.properties, entityTypeKey);
  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Instance validation failed", { fields: errors });
  }

  // Defaults from the full schema for properties not supplied — including
  // properties the lens hides. Coercion failures are swallowed: validation
  // has already passed, so the property is skipped.
  const fullEt = loaded.full.entityTypes[entityTypeKey];
  if (fullEt !== undefined) {
    for (const [propKey, propDef] of Object.entries(fullEt.properties)) {
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

  const entityId = randomUUID();

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

  const entity = await store.createEntity(
    entityTypeKey,
    entityId,
    coerced,
    fullEt?.properties ?? {},
  );

  // Chunk + embed document properties (no-op without embedding provider).
  await syncDocumentChunks(store, entityTypeKey, entityId, docValues);

  return filterEntityProperties(entity, scopedEt);
}

export async function listEntities(
  ontologyKey: string,
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
  const loaded = await loadSchema(ontologyKey, store);
  const scopedEt = loaded.scoped.entityTypes[entityTypeKey];
  if (scopedEt === undefined) {
    throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  }

  // The free-text term matches over in-scope string properties; when there
  // are none it is silently ignored (the adapter adds no clause).
  const stringProps = Object.values(scopedEt.properties)
    .filter((p) => p.dataType === "string")
    .map((p) => p.key);

  const sortField = validateSortField(sort, scopedEt.properties);

  const [rawItems, total] = await store.listEntities(
    entityTypeKey,
    scopedEt.properties,
    filters,
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
  ontologyKey: string,
  entityTypeKey: string,
  entityId: string,
  store: RuntimeStore,
  fields?: string[] | null,
): Promise<Row> {
  const loaded = await loadSchema(ontologyKey, store);
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

/**
 * Partial update: validate against the scoped properties, NO default
 * re-application. Null removes an optional property (and is rejected on a
 * required one); a payload that changes nothing returns the current state
 * without advancing `_updatedAt`.
 */
export async function updateEntity(
  ontologyKey: string,
  entityTypeKey: string,
  entityId: string,
  body: Row,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(ontologyKey, store);
  const scopedEt = loaded.scoped.entityTypes[entityTypeKey];
  if (scopedEt === undefined) {
    throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  }

  const [coerced, errors] = validateProperties(body, scopedEt.properties, entityTypeKey, true);
  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Instance validation failed", { fields: errors });
  }

  const setProps: Row = {};
  const removeProps: string[] = [];
  for (const [k, v] of Object.entries(coerced)) {
    if (v === null) {
      removeProps.push(k);
    } else {
      setProps[k] = v;
    }
  }

  if (Object.keys(setProps).length === 0 && removeProps.length === 0) {
    return getEntity(ontologyKey, entityTypeKey, entityId, store);
  }

  const fullEt = loaded.full.entityTypes[entityTypeKey];

  // Document properties: maintain stored lengths for changed values.
  const docKeys = fullEt !== undefined ? documentPropertyKeys(fullEt.properties) : new Set<string>();
  const docChanges: Row = {};
  for (const k of docKeys) {
    if (k in coerced) {
      docChanges[k] = coerced[k];
      const v = coerced[k];
      if (typeof v === "string") {
        setProps[docLengthKey(k)] = cpLength(v);
      } else {
        removeProps.push(docLengthKey(k));
      }
    }
  }

  const entity = await store.updateEntity(
    entityTypeKey,
    entityId,
    setProps,
    removeProps,
    fullEt?.properties ?? {},
  );
  if (entity === null) {
    throw new NotFoundError(`Entity '${entityId}' not found`);
  }

  // Re-chunk changed document properties only (no-op without provider).
  await syncDocumentChunks(store, entityTypeKey, entityId, docChanges);

  return filterEntityProperties(entity, scopedEt);
}

/**
 * Delete an entity, every relation attached to it in either direction —
 * including relations whose type the lens cannot see — and its document
 * chunks. The runtime cascade is silent: nothing warns, nothing refuses.
 */
export async function deleteEntity(
  ontologyKey: string,
  entityTypeKey: string,
  entityId: string,
  store: RuntimeStore,
): Promise<void> {
  const loaded = await loadSchema(ontologyKey, store);
  if (!(entityTypeKey in loaded.scoped.entityTypes)) {
    throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  }

  const deleted = await store.deleteEntity(entityTypeKey, entityId);
  if (!deleted) {
    throw new NotFoundError(`Entity '${entityId}' not found`);
  }
}

// ---------------------------------------------------------------------------
// Document properties: chunk sync, slice read, partial writes
// ---------------------------------------------------------------------------

/**
 * Replace the chunk nodes for the given document property values.
 *
 * For each property: delete its existing chunks, then (for non-null values)
 * re-chunk, embed, and write new chunk nodes. No-op when no embedding
 * provider is configured.
 */
export async function syncDocumentChunks(
  store: RuntimeStore,
  entityTypeKey: string,
  entityId: string,
  docValues: Row,
): Promise<void> {
  if (Object.keys(docValues).length === 0) {
    return;
  }
  const provider = getEmbeddingProvider();
  if (!provider) {
    return;
  }

  for (const [propertyKey, value] of Object.entries(docValues)) {
    // Reuse embeddings of chunks whose text is unchanged — after a partial
    // edit the chunker re-synchronizes on the same boundaries, so most
    // chunks keep their exact text (at shifted offsets) and only the
    // chunks overlapping the edit need a fresh embedding.
    const reusable = await store.getChunkEmbeddingsForEntityProperty(entityId, propertyKey);
    await store.deleteChunksForEntityProperty(entityId, propertyKey);
    if (!value) {
      continue;
    }

    const chunks = chunkDocument(
      value as string,
      settings.DOCUMENT_CHUNK_SIZE,
      settings.DOCUMENT_CHUNK_OVERLAP,
    );
    const rows: Row[] = [];
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index]!;
      const row: Row = {
        _id: randomUUID(),
        _entityId: entityId,
        _entityTypeKey: entityTypeKey,
        _propertyKey: propertyKey,
        _index: index,
        startChar: chunk.startChar,
        charLength: chunk.charLength,
        text: chunk.text,
      };
      let chunkEmbedding = reusable[chunk.text] ?? null;
      if (chunkEmbedding === null) {
        chunkEmbedding = await provider.embed(chunk.text);
      }
      if (chunkEmbedding !== null) {
        row._embedding = chunkEmbedding;
      }
      rows.push(row);
    }

    await store.createDocumentChunks(entityId, entityTypeKey, propertyKey, rows);
  }
}

/**
 * Resolve a scoped document property and return its current value plus the
 * loaded schema. Raises NotFoundError for unknown/out-of-scope types or
 * properties, non-document properties, and missing entities. An unset value
 * reads as "".
 */
async function loadDocumentValue(
  ontologyKey: string,
  entityTypeKey: string,
  entityId: string,
  propertyKey: string,
  store: RuntimeStore,
): Promise<{ value: string; loaded: Awaited<ReturnType<typeof loadSchema>> }> {
  const loaded = await loadSchema(ontologyKey, store);
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
  ontologyKey: string,
  entityTypeKey: string,
  entityId: string,
  propertyKey: string,
  offset: number,
  limit: number | null,
  store: RuntimeStore,
): Promise<Row> {
  const { value } = await loadDocumentValue(
    ontologyKey,
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
 * validation happens in the service, matching the Python request model. */
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
 * property's chunks are re-synced — unchanged chunk texts keep their
 * embeddings, so only chunks overlapping the edit are re-embedded.
 */
export async function editDocument(
  ontologyKey: string,
  entityTypeKey: string,
  entityId: string,
  propertyKey: string,
  body: DocumentEditBody,
  store: RuntimeStore,
): Promise<Row> {
  const { value, loaded } = await loadDocumentValue(
    ontologyKey,
    entityTypeKey,
    entityId,
    propertyKey,
    store,
  );

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
  );
  if (entity === null) {
    throw new NotFoundError(`Entity '${entityId}' not found`);
  }

  await syncDocumentChunks(store, entityTypeKey, entityId, { [propertyKey]: newValue });

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
 * Create a relation: validate properties against the SCOPED definitions,
 * apply defaults from the FULL schema, and check that both endpoints exist
 * and their entity types equal the relation type's declared source/target —
 * checked against the FULL schema, not the lens, so a narrow lens cannot
 * create an edge that is invalid under a wider one. Endpoint errors are
 * collected alongside property errors in ONE response.
 */
export async function createRelation(
  ontologyKey: string,
  relationTypeKey: string,
  fromEntityId: string,
  toEntityId: string,
  userProps: Row,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(ontologyKey, store);
  const scopedRt = loaded.scoped.relationTypes[relationTypeKey];
  if (scopedRt === undefined) {
    throw new NotFoundError(`Relation type '${relationTypeKey}' not found`);
  }

  const [coerced, errors] = validateProperties(userProps, scopedRt.properties, relationTypeKey);

  // Defaults from the full schema for properties not supplied.
  const fullRt = loaded.full.relationTypes[relationTypeKey];
  if (fullRt !== undefined) {
    for (const [propKey, propDef] of Object.entries(fullRt.properties)) {
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

  // Endpoint validation against the FULL schema's declared source/target.
  const fullRtForValidation = fullRt ?? scopedRt;
  const fromEntity = await store.getEntityById(fromEntityId);
  if (fromEntity === null) {
    errors.fromEntityId = `Source entity '${fromEntityId}' not found`;
  } else if (fromEntity._entityTypeKey !== fullRtForValidation.fromEntityTypeKey) {
    errors.fromEntityId =
      `Source entity type mismatch: expected '${fullRtForValidation.fromEntityTypeKey}', ` +
      `got '${fromEntity._entityTypeKey}'`;
  }

  const toEntity = await store.getEntityById(toEntityId);
  if (toEntity === null) {
    errors.toEntityId = `Target entity '${toEntityId}' not found`;
  } else if (toEntity._entityTypeKey !== fullRtForValidation.toEntityTypeKey) {
    errors.toEntityId =
      `Target entity type mismatch: expected '${fullRtForValidation.toEntityTypeKey}', ` +
      `got '${toEntity._entityTypeKey}'`;
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Instance validation failed", { fields: errors });
  }

  const relationId = randomUUID();

  const relation = await store.createRelation(
    relationTypeKey,
    relationId,
    fromEntityId,
    toEntityId,
    coerced,
    fullRtForValidation.properties,
  );

  return filterRelationProperties(relation, scopedRt);
}

export async function listRelations(
  ontologyKey: string,
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
  const loaded = await loadSchema(ontologyKey, store);
  const scopedRt = loaded.scoped.relationTypes[relationTypeKey];
  if (scopedRt === undefined) {
    throw new NotFoundError(`Relation type '${relationTypeKey}' not found`);
  }

  const sortField = validateSortField(sort, scopedRt.properties);

  const [rawItems, total] = await store.listRelations(
    relationTypeKey,
    scopedRt.properties,
    filters,
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
  ontologyKey: string,
  relationTypeKey: string,
  relationId: string,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(ontologyKey, store);
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
 * Partial update of relation properties. ENDPOINTS ARE IMMUTABLE: payload
 * keys `fromEntityId` / `toEntityId` are dropped SILENTLY — no error — and
 * properties in the same payload still apply.
 */
export async function updateRelation(
  ontologyKey: string,
  relationTypeKey: string,
  relationId: string,
  body: Row,
  store: RuntimeStore,
): Promise<Row> {
  const loaded = await loadSchema(ontologyKey, store);
  const scopedRt = loaded.scoped.relationTypes[relationTypeKey];
  if (scopedRt === undefined) {
    throw new NotFoundError(`Relation type '${relationTypeKey}' not found`);
  }

  const properties: Row = { ...body };
  delete properties.fromEntityId;
  delete properties.toEntityId;

  const [coerced, errors] = validateProperties(
    properties,
    scopedRt.properties,
    relationTypeKey,
    true,
  );
  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Instance validation failed", { fields: errors });
  }

  const setProps: Row = {};
  const removeProps: string[] = [];
  for (const [k, v] of Object.entries(coerced)) {
    if (v === null) {
      removeProps.push(k);
    } else {
      setProps[k] = v;
    }
  }

  if (Object.keys(setProps).length === 0 && removeProps.length === 0) {
    return getRelation(ontologyKey, relationTypeKey, relationId, store);
  }

  const fullRt = loaded.full.relationTypes[relationTypeKey];

  const relation = await store.updateRelation(
    relationTypeKey,
    relationId,
    setProps,
    removeProps,
    fullRt?.properties ?? scopedRt.properties,
  );
  if (relation === null) {
    throw new NotFoundError(`Relation '${relationId}' not found`);
  }
  return filterRelationProperties(relation, scopedRt);
}

/** Delete a relation; neither endpoint is touched. */
export async function deleteRelation(
  ontologyKey: string,
  relationTypeKey: string,
  relationId: string,
  store: RuntimeStore,
): Promise<void> {
  const loaded = await loadSchema(ontologyKey, store);
  if (!(relationTypeKey in loaded.scoped.relationTypes)) {
    throw new NotFoundError(`Relation type '${relationTypeKey}' not found`);
  }

  const deleted = await store.deleteRelation(relationTypeKey, relationId);
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
  ontologyKey: string,
  entityTypeKey: string,
  entityId: string,
  direction: string,
  relationTypeKey: string | null,
  limit: number,
  store: RuntimeStore,
  fields?: string[] | null,
  relationFields?: string[] | null,
): Promise<NeighborhoodResult> {
  const loaded = await loadSchema(ontologyKey, store);
  const scopedEt = loaded.scoped.entityTypes[entityTypeKey];
  if (scopedEt === undefined) {
    throw new NotFoundError(`Entity type '${entityTypeKey}' not found`);
  }

  let entity = await store.getEntity(entityTypeKey, entityId);
  if (entity === null) {
    throw new NotFoundError(`Entity '${entityId}' not found`);
  }

  const neighbors = await store.getNeighbors(entityId, direction, relationTypeKey, limit);

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
// OQL query execution
// ---------------------------------------------------------------------------

/**
 * Validate, compile, and execute a read-only OQL query.
 *
 * Returns `{columns, results}` with properties filtered to the scoped
 * ontology schema. Parsing and validation happen here, above the port;
 * the adapter compiles the validated query to its native dialect at
 * execution time. Ad-hoc queries run with NO parameter values —
 * placeholders parse, but binding is a saved-query concern.
 */
export async function executeQuery(
  ontologyKey: string,
  query: string,
  store: RuntimeStore,
): Promise<{ columns: string[]; results: Row[] }> {
  const loaded = await loadSchema(ontologyKey, store);
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

/** Remove properties not in the scoped schema and stub documents. Unlike
 * entity reads, only the SYSTEM properties survive here — other
 * underscore-prefixed bookkeeping is stripped (Python parity). */
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
