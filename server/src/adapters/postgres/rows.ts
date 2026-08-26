/**
 * Row mapping and the id-format guard, shared by the store modules.
 *
 * Row mapping rule (adapter-internal): snake_case columns become
 * camelCase `Row` keys at the read layer; `timestamptz` values arrive
 * from the driver as JS `Date`, satisfying the port's temporal rule.
 *
 * `isUuid()` is strict: it accepts exactly the format the server itself
 * generates — lowercase hyphenated 8-4-4-4-12. PostgreSQL's own uuid
 * parsing is more lenient (uppercase, braces, no hyphens); accepting
 * what PG accepts would let PG find rows where the reference adapter's
 * string comparison answers not-found. Every id-taking store method
 * checks its ids here first and short-circuits off-format input to the
 * method's not-found shape without touching the database — which also
 * keeps 22P02 unreachable from caller input.
 */

import type { Row } from "../../core/ports.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether a wire string is a server-format uuid. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function camelKey(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

/** One database row → a port `Row` with camelCase keys. */
export function camelizeRow(row: Row): Row {
  const result: Row = {};
  for (const [column, value] of Object.entries(row)) {
    result[camelKey(column)] = value;
  }
  return result;
}

/** All rows of a result → port `Row`s with camelCase keys. */
export function camelizeRows(rows: Row[]): Row[] {
  return rows.map(camelizeRow);
}
