/**
 * WHERE-clause construction for the Neo4j runtime adapter.
 *
 * Turns the structured filter/search inputs that cross the persistence
 * port (parsed filter conditions, search strings) into Cypher WHERE
 * fragments plus bound parameters. Adapter-private — query fragments
 * never leave this package.
 *
 * Validation happens above the port: the service parses, checks, and
 * coerces every filter, so what arrives here is valid by construction
 * and the builder is pure fragment assembly. VALUES are always bound
 * parameters; the only interpolated identifiers are property keys taken
 * from the STORED schema via the parsed conditions, never from raw
 * request input.
 */

import neo4j from "neo4j-driver";

import type { FilterCondition, PropertyFilterCondition } from "../../core/ports.js";
import { toNeo4jDate, toNeo4jDateTime } from "./temporal.js";

const OPERATORS: Record<string, string> = {
  eq: "=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
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

/** Build WHERE fragments and parameters from parsed filter conditions —
 * one fragment per condition, dispatched on its kind. */
export function buildFilterClauses(
  conditions: FilterCondition[],
  nodeAlias = "n",
): [string[], Record<string, unknown>] {
  const whereClauses: string[] = [];
  const params: Record<string, unknown> = {};

  for (const condition of conditions) {
    const paramName = `flt_${Object.keys(params).length}`;
    switch (condition.kind) {
      case "property": {
        const [clause, value] = buildPropertyClause(condition, nodeAlias, paramName);
        whereClauses.push(clause);
        params[paramName] = value;
        break;
      }
    }
  }

  return [whereClauses, params];
}

/** The fragment for one property condition on the aliased node or
 * relationship, plus the value to bind under `paramName`. Substring
 * comparison is textual — the parsed value is already the string form
 * and crosses untouched; every other value is converted to its
 * driver-native form. */
function buildPropertyClause(
  condition: PropertyFilterCondition,
  alias: string,
  paramName: string,
): [string, unknown] {
  if (condition.op === "contains") {
    return [
      `toLower(toString(${alias}.${condition.propertyKey})) CONTAINS toLower($${paramName})`,
      condition.value,
    ];
  }
  return [
    `${alias}.${condition.propertyKey} ${OPERATORS[condition.op]} $${paramName}`,
    toNeo4jParameter(condition.value, condition.dataType),
  ];
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
