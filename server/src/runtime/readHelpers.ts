import { CoercionError, assertNoNulCharacter, coerceValue } from "../core/dataTypes.js";
import { ValidationError } from "../core/exceptions.js";
import type { FilterCondition, FilterOperator, Row } from "../core/ports.js";
import type { PropertyDef } from "../core/schemas.js";
import type { EntityTypeDef, RelationTypeDef, SchemaCacheValue } from "./schemaCache.js";
import { cpLength } from "./codePoints.js";
import {
  isQueryPath,
  namesRelationType,
  resolveQueryPath,
  resolveRelationSubject,
  type ResolvedQueryPath,
} from "./queryPaths.js";
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

const COMPARISON_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
]);

/** The two existence operators: `exists` takes the flag as sent,
 * `missing` inverts it, so `__missing=true` and `__exists=false` are one
 * condition. */
const EXISTENCE_OPERATORS: Record<string, (flag: boolean) => boolean> = {
  exists: (flag) => flag,
  missing: (flag) => !flag,
};

/** One rejected filter key: the caller-facing message and the detail
 * reported under `field` in `details.fields`. */
interface FilterFault {
  field: string;
  message: string;
  detail: string;
}

/** A fault before its field is known — what the per-key parsers return. */
type Fault = Omit<FilterFault, "field">;

interface FilterParseOptions {
  /** A surface that cannot evaluate substring containment rejects
   * `__contains` with its own wording — one more collected fault, checked
   * before the key's other faults so a lone rejection reads unchanged. */
  rejectContains?: Fault;
  /** The lens-scoped schema query paths and relation subjects are
   * resolved against, `typeKey` being the listed entity type. Absent on
   * the surfaces that take no relation conditions, where a path key is
   * one more collected fault and a bare relation type key is unknown. */
  pathSchema?: SchemaCacheValue;
  /** With a path schema, the fault a resolved relation condition — a
   * path, or a relation existence test — raises instead of crossing the
   * port: for a surface that takes them in principle but whose adapter
   * declares no support. Resolution faults still come first, so a
   * malformed key is reported as malformed. */
  rejectRelationConditions?: (key: string) => Fault;
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

/** The fault for a path key on a surface that takes none. */
function pathsNotTaken(path: string, typeKey: string): Fault {
  return {
    message: `Query paths apply to entity lists only: '${path}'`,
    detail:
      `'${path}' is a query path; only a property key of '${typeKey}' ` +
      "can be filtered here",
  };
}

/** The fault for a subject that is neither a property of the listed type
 * nor — under an existence operator, where one is allowed — a relation
 * type; a relation type under a comparison operator says what it takes. */
function unknownSubject(
  subject: string,
  typeKey: string,
  existence: boolean,
  options: FilterParseOptions,
): Fault {
  if (!existence && options.pathSchema !== undefined && namesRelationType(subject, options.pathSchema)) {
    return {
      message: `Relation type '${subject}' takes only an existence operator`,
      detail:
        `'${subject}' names a relation type; write '${subject}__exists' or ` +
        `'${subject}__missing' with true or false, or a query path to one of its properties`,
    };
  }
  return {
    message: `Unknown filter property: '${subject}'`,
    detail: `Not defined in type '${typeKey}'`,
  };
}

/** Parse one comparison filter — a bare key or a comparison suffix — into
 * its property or path condition, or the first fault: unknown property
 * (or unresolvable path), uncoercible value, unknown operator. */
function parseComparison(
  subject: string,
  opName: string | null,
  rawValue: string,
  propertyDefs: Record<string, PropertyDef>,
  typeKey: string,
  options: FilterParseOptions,
): FilterCondition | Fault {
  let propDef: PropertyDef | undefined;
  let path: ResolvedQueryPath | null = null;
  if (isQueryPath(subject)) {
    if (options.pathSchema === undefined) {
      return pathsNotTaken(subject, typeKey);
    }
    const resolved = resolveQueryPath(subject, typeKey, options.pathSchema);
    if (!("propertyDef" in resolved)) {
      return resolved;
    }
    path = resolved;
    propDef = resolved.propertyDef;
  } else {
    propDef = propertyDefs[subject];
  }
  if (propDef === undefined) {
    return unknownSubject(subject, typeKey, false, options);
  }

  let value: unknown;
  try {
    if (opName === "contains") {
      const text = String(rawValue); // substring comparison is textual
      assertNoNulCharacter(text, subject);
      value = text;
    } else {
      value = coerceValue(rawValue, propDef.dataType, subject);
    }
  } catch (error) {
    if (!(error instanceof CoercionError)) throw error;
    return { message: `Invalid filter value for '${subject}'`, detail: error.message };
  }

  let op: FilterOperator;
  if (opName === null) {
    op = "eq";
  } else if (COMPARISON_OPERATORS.has(opName as FilterOperator)) {
    op = opName as FilterOperator;
  } else {
    return {
      message: `Unknown filter operator: '${opName}'`,
      detail: `Unsupported operator '${opName}'`,
    };
  }

  if (path !== null) {
    if (options.rejectRelationConditions !== undefined) {
      return options.rejectRelationConditions(subject);
    }
    return {
      kind: "path",
      relationTypeKey: path.relationTypeKey,
      direction: path.direction,
      propertySource: path.propertySource,
      propertyKey: path.propertyKey,
      dataType: propDef.dataType,
      op,
      value,
    };
  }
  return { kind: "property", propertyKey: subject, dataType: propDef.dataType, op, value };
}

/** Parse one existence filter — `__exists` or `__missing` — into its
 * property, path or relation existence condition, or the first fault:
 * unknown subject (or unresolvable path or relation), then a flag that
 * is not a boolean. The subject is resolved as a property of the listed
 * type first, then — with a path schema — as a query path or a bare
 * relation type; no data type takes part, so nothing is coerced but the
 * flag. */
function parseExistence(
  subject: string,
  opName: string,
  rawValue: string,
  propertyDefs: Record<string, PropertyDef>,
  typeKey: string,
  options: FilterParseOptions,
): FilterCondition | Fault {
  let condition: FilterCondition;
  if (isQueryPath(subject)) {
    if (options.pathSchema === undefined) {
      return pathsNotTaken(subject, typeKey);
    }
    const resolved = resolveQueryPath(subject, typeKey, options.pathSchema);
    if (!("propertyDef" in resolved)) {
      return resolved;
    }
    condition = {
      kind: "path-existence",
      relationTypeKey: resolved.relationTypeKey,
      direction: resolved.direction,
      propertySource: resolved.propertySource,
      propertyKey: resolved.propertyKey,
      exists: true,
    };
  } else if (propertyDefs[subject] !== undefined) {
    condition = { kind: "property-existence", propertyKey: subject, exists: true };
  } else if (options.pathSchema !== undefined) {
    const resolved = resolveRelationSubject(subject, typeKey, options.pathSchema);
    if (!("direction" in resolved)) {
      return resolved;
    }
    condition = {
      kind: "relation-existence",
      relationTypeKey: resolved.relationTypeKey,
      direction: resolved.direction,
      exists: true,
    };
  } else {
    return unknownSubject(subject, typeKey, true, options);
  }

  let flag: boolean;
  try {
    flag = coerceValue(rawValue, "boolean", subject) as boolean;
  } catch (error) {
    if (!(error instanceof CoercionError)) throw error;
    return { message: `Invalid filter value for '${subject}'`, detail: error.message };
  }
  condition.exists = EXISTENCE_OPERATORS[opName]!(flag);

  if (condition.kind !== "property-existence" && options.rejectRelationConditions !== undefined) {
    return options.rejectRelationConditions(subject);
  }
  return condition;
}

/**
 * Parse a list-endpoint filter map into the conditions that cross the
 * port. The operator is the segment after the LAST double underscore —
 * so a property whose own key contains `__` cannot be filtered
 * (documented trap). A comparison key yields at most one fault —
 * unknown property, uncoercible value, unknown operator, checked in that
 * order; an existence key (`__exists`, `__missing`) likewise — unknown
 * subject, then a non-boolean flag — reported under the filter key as
 * sent; the faults of all keys are collected into one
 * `ValidationError`, raised here, above the port, identically for every
 * backend. `contains` compares textually and skips type coercion; the
 * existence operators coerce nothing but their flag.
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
    let subject: string;
    let opName: string | null;
    const splitAt = filterExpr.lastIndexOf("__");
    if (splitAt >= 0) {
      subject = filterExpr.slice(0, splitAt);
      opName = filterExpr.slice(splitAt + 2);
    } else {
      subject = filterExpr;
      opName = null;
    }

    let parsed: FilterCondition | Fault;
    if (opName === "contains" && options.rejectContains !== undefined) {
      parsed = options.rejectContains;
    } else if (opName !== null && opName in EXISTENCE_OPERATORS) {
      parsed = parseExistence(subject, opName, rawValue, propertyDefs, typeKey, options);
    } else {
      parsed = parseComparison(subject, opName, rawValue, propertyDefs, typeKey, options);
    }
    if ("kind" in parsed) {
      conditions.push(parsed);
    } else {
      faults.push({ field: filterExpr, ...parsed });
    }
  }

  if (faults.length > 0) {
    throw filterFaultsError(faults);
  }
  return conditions;
}
