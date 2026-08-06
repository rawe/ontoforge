/**
 * WHERE-clause construction for the Neo4j runtime adapter.
 *
 * Turns the structured filter/search inputs that cross the persistence
 * port (filter dicts, search strings) into Cypher WHERE fragments plus
 * bound parameters. Adapter-private — query fragments never leave this
 * package.
 *
 * Injection posture (binding, per the session-04 spec): VALUES are always
 * bound parameters; the only interpolated identifiers are property keys
 * taken from the STORED schema's definitions (`propertyDefs`), never from
 * request input — an unknown key is rejected before any text is built.
 */

import neo4j from "neo4j-driver";

import { CoercionError, coerceValue } from "../../core/dataTypes.js";
import { ValidationError } from "../../core/exceptions.js";
import type { PropertyDef } from "../../runtime/schemaCache.js";
import { toNeo4jDate, toNeo4jDateTime } from "./temporal.js";

const OPERATORS: Record<string, string> = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  contains: "CONTAINS",
};

/** Convert a coerced port value to its driver-native parameter form. */
export function toNeo4jParameter(value: unknown, dataType: string): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  switch (dataType) {
    case "integer":
      return neo4j.int(value as number);
    case "date":
      return toNeo4jDate(value as string);
    case "datetime":
      return toNeo4jDateTime(value as Date);
    default:
      return value;
  }
}

/**
 * Build WHERE fragments and parameters from a list-endpoint filter dict.
 *
 * The operator is the segment after the LAST double underscore — so a
 * property whose own key contains `__` cannot be filtered (documented
 * trap). Unknown properties, unknown operators, and uncoercible values
 * raise `ValidationError`, checked in that order: property, then value,
 * then operator.
 */
export function buildFilterClauses(
  filters: Record<string, string>,
  propertyDefs: Record<string, PropertyDef>,
  typeKey: string,
  nodeAlias = "n",
): [string[], Record<string, unknown>] {
  const whereClauses: string[] = [];
  const params: Record<string, unknown> = {};

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

    const propDef = propertyDefs[propKey];
    if (propDef === undefined) {
      throw new ValidationError(`Unknown filter property: '${propKey}'`, {
        fields: { [propKey]: `Not defined in type '${typeKey}'` },
      });
    }

    let coercedValue: unknown;
    try {
      if (opName === "contains") {
        coercedValue = String(rawValue); // substring comparison is textual
      } else {
        coercedValue = coerceValue(rawValue, propDef.dataType, propKey);
      }
    } catch (error) {
      if (!(error instanceof CoercionError)) throw error;
      throw new ValidationError(`Invalid filter value for '${propKey}'`, {
        fields: { [propKey]: error.message },
      });
    }

    const paramName = `flt_${Object.keys(params).length}`;

    if (opName === null) {
      whereClauses.push(`${nodeAlias}.${propKey} = $${paramName}`);
    } else if (opName === "contains") {
      whereClauses.push(
        `toLower(toString(${nodeAlias}.${propKey})) CONTAINS toLower($${paramName})`,
      );
    } else if (opName in OPERATORS) {
      whereClauses.push(`${nodeAlias}.${propKey} ${OPERATORS[opName]} $${paramName}`);
    } else {
      throw new ValidationError(`Unknown filter operator: '${opName}'`, {
        fields: { [filterExpr]: `Unsupported operator '${opName}'` },
      });
    }

    params[paramName] =
      opName === "contains" ? coercedValue : toNeo4jParameter(coercedValue, propDef.dataType);
  }

  return [whereClauses, params];
}

/** The case-insensitive substring search clause over string properties. */
export function buildSearchClause(
  search: string,
  propertyKeys: string[],
  nodeAlias = "n",
): [string, Record<string, unknown>] {
  const qClauses = propertyKeys.map(
    (prop) => `toLower(toString(${nodeAlias}.${prop})) CONTAINS toLower($q_search)`,
  );
  return [`(${qClauses.join(" OR ")})`, { q_search: search }];
}
