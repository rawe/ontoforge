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

import { CoercionError, coerceValue } from "../core/dataTypes.js";
import { NotFoundError, ValidationError } from "../core/exceptions.js";
import type { RuntimeStore } from "../core/ports.js";
import {
  loadSchema,
  type EntityTypeDef,
  type PropertyDef,
  type RelationTypeDef,
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
// Document properties (stub read model; routes arrive in session 06)
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
      length = typeof value === "string" ? value.length : 0;
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
  for (const k of docKeys) {
    const v = coerced[k];
    if (typeof v === "string") {
      coerced[docLengthKey(k)] = v.length;
    }
  }

  const entity = await store.createEntity(
    entityTypeKey,
    entityId,
    coerced,
    fullEt?.properties ?? {},
  );

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
  for (const k of docKeys) {
    if (k in coerced) {
      const v = coerced[k];
      if (typeof v === "string") {
        setProps[docLengthKey(k)] = v.length;
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
