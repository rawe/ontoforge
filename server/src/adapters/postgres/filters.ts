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
 * escape; injection via key is impossible by construction. The substring
 * idiom is `position(lower($v) in lower(props->>$k)) > 0`: no ILIKE, no
 * escape helper, no wildcard bug class; an empty search string matches
 * every row and a missing property yields NULL and excludes the row,
 * matching Cypher `CONTAINS`. The sort direction is a build-time literal
 * from a closed enum, never caller text, and every listing ORDER BY ends
 * with the `id` tie-break for deterministic pagination among equal sort
 * values. Callers guard endpoint ids with `isUuid()` first and
 * short-circuit off-format input to the empty page — the fragments here
 * assume server-format ids.
 */

import type { FilterCondition } from "../../core/ports.js";
import type { PropertyDef } from "../../core/schemas.js";

const OPERATORS: Record<Exclude<FilterCondition["op"], "contains">, string> = {
  eq: "=",
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

/** The accessor over this module's own `props` column, key bound at the
 * given placeholder. */
function accessor(dataType: string, keyPlaceholder: number): string {
  return jsonAccessor(dataType, "props", `$${keyPlaceholder}`);
}

/** Append one value to the params array, returning its placeholder number. */
function bind(params: unknown[], value: unknown): number {
  params.push(value);
  return params.length;
}

/** WHERE fragments for parsed filter conditions, ANDed by the caller. */
export function buildFilterClauses(
  conditions: FilterCondition[],
  params: unknown[],
): string[] {
  const clauses: string[] = [];
  for (const condition of conditions) {
    if (condition.op === "contains") {
      const valueP = bind(params, condition.value);
      const keyP = bind(params, condition.key);
      clauses.push(`position(lower($${valueP}) in lower(props->>$${keyP})) > 0`);
    } else {
      const keyP = bind(params, condition.key);
      const valueP = bind(params, condition.value);
      clauses.push(`${accessor(condition.dataType, keyP)} ${OPERATORS[condition.op]} $${valueP}`);
    }
  }
  return clauses;
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
    sortExpr = accessor(propertyDefs[sortField]?.dataType ?? "string", bind(params, sortField));
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
