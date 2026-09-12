/**
 * Predicate construction for the PostgreSQL runtime adapter.
 *
 * Pure fragment assembly over the parsed conditions the service supplies
 * — validation happens above the port, so nothing here raises. Fragments
 * never leave this package; every builder appends to a shared positional
 * params array and numbers its placeholders from the array's length, so
 * fragments compose into one statement in any order.
 *
 * Binding discipline: property keys AND values are bound parameters —
 * `(props->>$1)::cast <op> $2` — nothing interpolated, nothing to
 * escape; injection via key is impossible by construction. A missing
 * property yields NULL under every comparison, `<>` included, and
 * excludes the row. The substring
 * idiom is `position(lower($v) in lower(props->>$k)) > 0`: no ILIKE, no
 * escape helper, no wildcard bug class; an empty search string matches
 * every row and a missing property yields NULL and excludes the row,
 * matching Cypher `CONTAINS`. Existence is jsonb key presence, `props ?
 * $k` — the service stores no nulls, so a stored key is a present value
 * — and relation existence is an `EXISTS` / `NOT EXISTS` over the
 * relation table with no value compared. The sort direction is a build-time literal
 * from a closed enum, never caller text, and every listing ORDER BY ends
 * with the `id` tie-break for deterministic pagination among equal sort
 * values. Callers guard endpoint ids with `isUuid()` first and
 * short-circuit off-format input to the empty page — the fragments here
 * assume server-format ids.
 */

import type {
  FilterCondition,
  PathExistenceCondition,
  PathFilterCondition,
  PropertyFilterCondition,
  RelationExistenceCondition,
} from "../../core/ports.js";
import type { PropertyDef } from "../../core/schemas.js";

const OPERATORS: Record<Exclude<PropertyFilterCondition["op"], "contains">, string> = {
  eq: "=",
  ne: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

/**
 * The typed jsonb accessor for a data type — the encoding table's SQL
 * read-back form, in one place. `container` is the jsonb column
 * expression and `key` the SQL for the property key: a bound placeholder
 * here at the port, an inlined schema key in the OQL compiler.
 */
export function jsonAccessor(dataType: string, container: string, key: string): string {
  switch (dataType) {
    case "integer":
      return `(${container}->${key})::numeric`;
    case "float":
      return `(${container}->${key})::float8`;
    case "boolean":
      return `(${container}->${key})::boolean`;
    case "date":
      return `(${container}->>${key})::date`;
    case "datetime":
      return `(${container}->>${key})::timestamptz`;
    default: // string, document — text under the default collation
      return `${container}->>${key}`;
  }
}

/** The accessor over a `props` column, key bound at the given placeholder. */
function accessor(dataType: string, container: string, keyPlaceholder: number): string {
  return jsonAccessor(dataType, container, `$${keyPlaceholder}`);
}

/** Append one value to the params array, returning its placeholder number. */
function bind(params: unknown[], value: unknown): number {
  params.push(value);
  return params.length;
}

/** WHERE fragments for parsed filter conditions, ANDed by the caller;
 * one predicate per condition, dispatched on its kind. */
export function buildFilterClauses(
  conditions: FilterCondition[],
  params: unknown[],
): string[] {
  const clauses: string[] = [];
  for (const condition of conditions) {
    switch (condition.kind) {
      case "property":
        clauses.push(buildPropertyClause(condition, "props", params));
        break;
      case "property-existence":
        clauses.push(buildExistenceClause(condition.propertyKey, condition.exists, "props", params));
        break;
      case "path":
        clauses.push(
          buildPathClause(condition, params, (container) =>
            buildPropertyClause(condition, container, params),
          ),
        );
        break;
      case "path-existence":
        clauses.push(
          buildPathClause(condition, params, (container) =>
            buildExistenceClause(condition.propertyKey, condition.exists, container, params),
          ),
        );
        break;
      case "relation-existence":
        clauses.push(buildRelationExistenceClause(condition, params));
        break;
      default: {
        const unhandled: never = condition;
        throw new Error(`Unhandled filter condition kind: ${String(unhandled)}`);
      }
    }
  }
  return clauses;
}

/** The predicate for one property comparison over the given `props`
 * column — the listed row's own, or the related row's inside a path
 * subquery. */
function buildPropertyClause(
  condition: Pick<PropertyFilterCondition, "propertyKey" | "dataType" | "op" | "value">,
  container: string,
  params: unknown[],
): string {
  if (condition.op === "contains") {
    const valueP = bind(params, condition.value);
    const keyP = bind(params, condition.propertyKey);
    return `position(lower($${valueP}) in lower(${container}->>$${keyP})) > 0`;
  }
  const keyP = bind(params, condition.propertyKey);
  const valueP = bind(params, condition.value);
  return `${accessor(condition.dataType, container, keyP)} ${OPERATORS[condition.op]} $${valueP}`;
}

/** The predicate for one property's presence — jsonb key existence over
 * the given `props` column, the key bound — or its absence. */
function buildExistenceClause(
  propertyKey: string,
  exists: boolean,
  container: string,
  params: unknown[],
): string {
  const keyP = bind(params, propertyKey);
  return exists ? `${container} ? $${keyP}` : `NOT (${container} ? $${keyP})`;
}

/** The near and far endpoint columns of a relation row followed in the
 * given direction from the listed row. */
function endpoints(direction: PathFilterCondition["direction"]): [string, string] {
  return direction === "outgoing" ? ["from_id", "to_id"] : ["to_id", "from_id"];
}

/**
 * The existential predicate for one path condition: a relation row of the
 * type, anchored on the listed row (`entity` — the outer query's table,
 * unaliased) at the near endpoint. For a property of the related entity
 * the relation row is joined to the related row at the far endpoint and
 * the predicate is on that row; for a property of the relation itself
 * the predicate is on the relation row's own properties and no entity
 * is joined. `predicate` builds it over the `props` column it is handed —
 * a comparison or an existence test. Self-contained per condition, so
 * two paths through one relation type may be satisfied by two different
 * relation rows. The relation type key is bound like every property key.
 */
function buildPathClause(
  condition: Pick<PathExistenceCondition, "relationTypeKey" | "direction" | "propertySource">,
  params: unknown[],
  predicate: (container: string) => string,
): string {
  const [near, far] = endpoints(condition.direction);
  const onRelation = condition.propertySource === "relation";
  const source = onRelation ? "relation r" : `relation r JOIN entity re ON re.id = r.${far}`;
  const typeP = bind(params, condition.relationTypeKey);
  return (
    `EXISTS (SELECT 1 FROM ${source} ` +
    `WHERE r.${near} = entity.id AND r.type_key = $${typeP} AND ${predicate(onRelation ? "r.props" : "re.props")})`
  );
}

/** The anti-existence predicate for a relation existence condition: any
 * relation row of the type anchored on the listed row at the near
 * endpoint (`EXISTS`), or none at all (`NOT EXISTS`); no related row is
 * read and no value compared. */
function buildRelationExistenceClause(
  condition: RelationExistenceCondition,
  params: unknown[],
): string {
  const [near] = endpoints(condition.direction);
  const typeP = bind(params, condition.relationTypeKey);
  const subquery = `SELECT 1 FROM relation r WHERE r.${near} = entity.id AND r.type_key = $${typeP}`;
  return `${condition.exists ? "EXISTS" : "NOT EXISTS"} (${subquery})`;
}

/** The free-text search fragment: the contains idiom ORed over the
 * string property keys, one shared bound search value. */
export function buildSearchClause(
  search: string,
  propertyKeys: string[],
  params: unknown[],
): string {
  const searchP = bind(params, search);
  const branches = propertyKeys.map(
    (key) => `position(lower($${searchP}) in lower(props->>$${bind(params, key)})) > 0`,
  );
  return `(${branches.join(" OR ")})`;
}

/** The ORDER BY clause: typed sort per the accessor table, the system
 * timestamps on their real columns, direction a literal from the closed
 * enum, and the `id` tie-break appended. */
export function buildOrderBy(
  sortField: string,
  propertyDefs: Record<string, PropertyDef>,
  order: string,
  params: unknown[],
): string {
  const direction = order === "desc" ? "DESC" : "ASC";
  let sortExpr: string;
  if (sortField === "_createdAt") {
    sortExpr = "created_at";
  } else if (sortField === "_updatedAt") {
    sortExpr = "updated_at";
  } else {
    sortExpr = accessor(
      propertyDefs[sortField]?.dataType ?? "string",
      "props",
      bind(params, sortField),
    );
  }
  return `ORDER BY ${sortExpr} ${direction}, id`;
}

/** Relation endpoint fragments over the indexed from_id/to_id columns. */
export function buildEndpointClauses(
  fromEntityId: string | null,
  toEntityId: string | null,
  params: unknown[],
): string[] {
  const clauses: string[] = [];
  if (fromEntityId !== null) {
    clauses.push(`from_id = $${bind(params, fromEntityId)}`);
  }
  if (toEntityId !== null) {
    clauses.push(`to_id = $${bind(params, toEntityId)}`);
  }
  return clauses;
}
