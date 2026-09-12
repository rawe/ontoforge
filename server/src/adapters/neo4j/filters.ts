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
 * parameters; the only interpolated identifiers are property keys and
 * relation type keys taken from the STORED schema via the parsed
 * conditions, never from raw request input. A missing property is null
 * in Cypher, so it fails every comparison, `<>` included; existence is
 * `IS NOT NULL` / `IS NULL`, and relation existence an `EXISTS` / `NOT
 * EXISTS` pattern predicate binding no value — existence conditions
 * bind nothing at all.
 */

import neo4j from "neo4j-driver";

import type {
  FilterCondition,
  PathExistenceCondition,
  PathFilterCondition,
  PropertyFilterCondition,
  RelationExistenceCondition,
} from "../../core/ports.js";
import { toUpperSnakeCase } from "./ddl.js";
import { toNeo4jDate, toNeo4jDateTime } from "./temporal.js";

const OPERATORS: Record<string, string> = {
  eq: "=",
  ne: "<>",
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

/** A built fragment: the clause, and the value to bind under the
 * condition's parameter name when the condition carries one. */
type Fragment = [clause: string] | [clause: string, value: unknown];

/** Build WHERE fragments and parameters from parsed filter conditions —
 * one fragment per condition, dispatched on its kind; a condition with a
 * value binds it under the next `flt_<n>` name, one without binds nothing. */
export function buildFilterClauses(
  conditions: FilterCondition[],
  nodeAlias = "n",
): [string[], Record<string, unknown>] {
  const whereClauses: string[] = [];
  const params: Record<string, unknown> = {};

  for (const condition of conditions) {
    const paramName = `flt_${Object.keys(params).length}`;
    const fragment = buildFragment(condition, nodeAlias, paramName);
    whereClauses.push(fragment[0]);
    if (fragment.length === 2) {
      params[paramName] = fragment[1];
    }
  }

  return [whereClauses, params];
}

function buildFragment(condition: FilterCondition, alias: string, paramName: string): Fragment {
  switch (condition.kind) {
    case "property":
      return buildPropertyClause(condition, alias, paramName);
    case "property-existence":
      return [buildExistenceClause(condition.propertyKey, condition.exists, alias)];
    case "path": {
      const onRelation = condition.propertySource === "relation";
      const [predicate, value] = buildPropertyClause(condition, onRelation ? "r" : "re", paramName);
      return [buildPathClause(condition, alias, predicate), value];
    }
    case "path-existence": {
      const onRelation = condition.propertySource === "relation";
      const predicate = buildExistenceClause(
        condition.propertyKey,
        condition.exists,
        onRelation ? "r" : "re",
      );
      return [buildPathClause(condition, alias, predicate)];
    }
    case "relation-existence":
      return [buildRelationExistenceClause(condition, alias)];
    default: {
      const unhandled: never = condition;
      throw new Error(`Unhandled filter condition kind: ${String(unhandled)}`);
    }
  }
}

/** The relationship pattern from the listed node for a relation type
 * followed in the given direction — the relationship bound as `r` when
 * asked, the related node as `re` when asked, anonymous otherwise. The
 * relationship type is the stored relation type key's physical form.
 * The names `r` and `re` are fixed: relation conditions reach only
 * entity lists and searches, whose outer query binds the listed node
 * alone, so nothing they could shadow is in scope. */
function relationPattern(
  condition: Pick<RelationExistenceCondition, "relationTypeKey" | "direction">,
  alias: string,
  bindRelationship: boolean,
  bindRelated: boolean,
): string {
  const relationship = `[${bindRelationship ? "r" : ""}:${toUpperSnakeCase(condition.relationTypeKey)}]`;
  const related = bindRelated ? "(re)" : "()";
  return condition.direction === "outgoing"
    ? `(${alias})-${relationship}->${related}`
    : `(${alias})<-${relationship}-${related}`;
}

/**
 * The existential pattern predicate for one path condition: from the
 * listed node, one relationship of the type in the resolved direction.
 * For a property of the related entity the pattern binds the related
 * node `re` and the predicate is on it; for a property of the relation
 * itself the pattern binds the relationship `r`, the related node stays
 * anonymous, and the predicate is on the relationship. Self-contained
 * per condition, so two paths through one relation type may be satisfied
 * by two different relationships.
 */
function buildPathClause(
  condition: Pick<PathExistenceCondition, "relationTypeKey" | "direction" | "propertySource">,
  alias: string,
  predicate: string,
): string {
  const onRelation = condition.propertySource === "relation";
  const pattern = relationPattern(condition, alias, onRelation, !onRelation);
  return `EXISTS { MATCH ${pattern} WHERE ${predicate} }`;
}

/** The anti-existence predicate for a relation existence condition: any
 * relationship of the type from the listed node in the resolved
 * direction (`EXISTS`), or none at all (`NOT EXISTS`); nothing is bound
 * and no value compared. */
function buildRelationExistenceClause(condition: RelationExistenceCondition, alias: string): string {
  const pattern = relationPattern(condition, alias, false, false);
  return `${condition.exists ? "EXISTS" : "NOT EXISTS"} { MATCH ${pattern} }`;
}

/** The fragment for one property condition on the aliased node or
 * relationship, plus the value to bind under `paramName`. Substring
 * comparison is textual — the parsed value is already the string form
 * and crosses untouched; every other value is converted to its
 * driver-native form. */
function buildPropertyClause(
  condition: Pick<PropertyFilterCondition, "propertyKey" | "dataType" | "op" | "value">,
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

/** The predicate for one property's presence or absence on the aliased
 * node or relationship — a missing property is null. */
function buildExistenceClause(propertyKey: string, exists: boolean, alias: string): string {
  return `${alias}.${propertyKey} IS ${exists ? "NOT NULL" : "NULL"}`;
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
