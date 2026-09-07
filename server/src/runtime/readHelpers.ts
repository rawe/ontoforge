import { CoercionError, assertNoNulCharacter, coerceValue } from "../core/dataTypes.js";
import { ValidationError } from "../core/exceptions.js";
import type { FilterCondition, FilterOperator, Row } from "../core/ports.js";
import type { PropertyDef } from "../core/schemas.js";
import type { EntityTypeDef, RelationTypeDef, SchemaCacheValue } from "./schemaCache.js";
import { cpLength } from "./codePoints.js";
import { isQueryPath, resolveQueryPath, type ResolvedQueryPath } from "./queryPaths.js";
const DOC_LENGTH_PREFIX = "_doc_";
const DOC_LENGTH_SUFFIX = "_length";

/** Internal entity property storing a document property's character count. */
export function docLengthKey(propertyKey: string): string {
  return `${DOC_LENGTH_PREFIX}${propertyKey}${DOC_LENGTH_SUFFIX}`;
}

export function documentPropertyKeys(propertyDefs: Record<string, PropertyDef>): Set<string> {
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
export function stubDocumentProperties(
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
export function filterEntityProperties(
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

export const ENTITY_ALWAYS_FIELDS: ReadonlySet<string> = new Set(["_id"]);
export const ENTITY_NEIGHBOR_ALWAYS_FIELDS: ReadonlySet<string> = new Set([
  "_id",
  "_entityTypeKey",
]);
export const RELATION_ALWAYS_FIELDS: ReadonlySet<string> = new Set([
  "_id",
  "_relationTypeKey",
  "direction",
]);

/** Filter relation properties to the scoped schema. Endpoint ids — the
 * documented exception to the underscore convention — and the computed
 * `direction` always survive. */
export function filterRelationProperties(relation: Row, scopedRt: RelationTypeDef): Row {
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

export function applyFieldProjection(
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

/** Extract `filter.<key>` query parameters; a repeated parameter keeps its
 * last value. */
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

const FILTER_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
]);

/** One rejected filter key: the caller-facing message and the detail
 * reported under `field` in `details.fields`. */
interface FilterFault {
  field: string;
  message: string;
  detail: string;
}

interface FilterParseOptions {
  /** A surface that cannot evaluate substring containment rejects
   * `__contains` with its own wording — one more collected fault, checked
   * before the key's other faults so a lone rejection reads unchanged. */
  rejectContains?: Omit<FilterFault, "field">;
  /** The lens-scoped schema query paths are resolved against, `typeKey`
   * being the listed entity type. Absent on the surfaces that take no
   * paths, where a path key is one more collected fault. */
  pathSchema?: SchemaCacheValue;
  /** With no path schema, the fault a path key raises — for a surface
   * that takes paths in principle but whose adapter declares no support.
   * Absent, the surface is one paths never reach, and the fault says so. */
  rejectPaths?: (path: string) => Omit<FilterFault, "field">;
}

/** The single rejection for a set of filter faults: every fault under its
 * own field, the distinct messages joined — so a lone fault reads exactly
 * as it always did. */
export function filterFaultsError(faults: FilterFault[]): ValidationError {
  const fields: Record<string, string> = {};
  for (const fault of faults) {
    fields[fault.field] = fault.detail;
  }
  const messages = [...new Set(faults.map((fault) => fault.message))];
  return new ValidationError(messages.join("; "), { fields });
}

/**
 * Parse a list-endpoint filter map into the conditions that cross the
 * port. The operator is the segment after the LAST double underscore —
 * so a property whose own key contains `__` cannot be filtered
 * (documented trap). Each key yields at most one fault — unknown
 * property, uncoercible value, unknown operator, checked in that order —
 * reported under the filter key as sent; the faults of all keys are
 * collected into one `ValidationError`, raised here, above the port,
 * identically for every backend.
 * `contains` compares textually and skips type coercion.
 */
export function parseFilterConditions(
  filters: Record<string, string>,
  propertyDefs: Record<string, PropertyDef>,
  typeKey: string,
  options: FilterParseOptions = {},
): FilterCondition[] {
  const conditions: FilterCondition[] = [];
  const faults: FilterFault[] = [];

  for (const [filterExpr, rawValue] of Object.entries(filters)) {
    let propKey: string;
    let opName: string | null;
    const splitAt = filterExpr.lastIndexOf("__");
    if (splitAt >= 0) {
      propKey = filterExpr.slice(0, splitAt);
      opName = filterExpr.slice(splitAt + 2);
    } else {
      propKey = filterExpr;
      opName = null;
    }

    if (opName === "contains" && options.rejectContains !== undefined) {
      faults.push({ field: filterExpr, ...options.rejectContains });
      continue;
    }

    let propDef: PropertyDef | undefined;
    let path: ResolvedQueryPath | null = null;
    if (isQueryPath(propKey)) {
      if (options.pathSchema === undefined) {
        const fault = options.rejectPaths?.(propKey) ?? {
          message: `Query paths apply to entity lists only: '${propKey}'`,
          detail:
            `'${propKey}' is a query path; only a property key of '${typeKey}' ` +
            "can be filtered here",
        };
        faults.push({ field: filterExpr, ...fault });
        continue;
      }
      const resolved = resolveQueryPath(propKey, typeKey, options.pathSchema);
      if (!("propertyDef" in resolved)) {
        faults.push({ field: filterExpr, ...resolved });
        continue;
      }
      path = resolved;
      propDef = resolved.propertyDef;
    } else {
      propDef = propertyDefs[propKey];
    }
    if (propDef === undefined) {
      faults.push({
        field: filterExpr,
        message: `Unknown filter property: '${propKey}'`,
        detail: `Not defined in type '${typeKey}'`,
      });
      continue;
    }

    let value: unknown;
    try {
      if (opName === "contains") {
        const text = String(rawValue); // substring comparison is textual
        assertNoNulCharacter(text, propKey);
        value = text;
      } else {
        value = coerceValue(rawValue, propDef.dataType, propKey);
      }
    } catch (error) {
      if (!(error instanceof CoercionError)) throw error;
      faults.push({
        field: filterExpr,
        message: `Invalid filter value for '${propKey}'`,
        detail: error.message,
      });
      continue;
    }

    let op: FilterOperator;
    if (opName === null) {
      op = "eq";
    } else if (FILTER_OPERATORS.has(opName as FilterOperator)) {
      op = opName as FilterOperator;
    } else {
      faults.push({
        field: filterExpr,
        message: `Unknown filter operator: '${opName}'`,
        detail: `Unsupported operator '${opName}'`,
      });
      continue;
    }

    if (path !== null) {
      conditions.push({
        kind: "path",
        relationTypeKey: path.relationTypeKey,
        direction: path.direction,
        propertySource: path.propertySource,
        propertyKey: path.propertyKey,
        dataType: propDef.dataType,
        op,
        value,
      });
    } else {
      conditions.push({
        kind: "property",
        propertyKey: propKey,
        dataType: propDef.dataType,
        op,
        value,
      });
    }
  }

  if (faults.length > 0) {
    throw filterFaultsError(faults);
  }
  return conditions;
}
