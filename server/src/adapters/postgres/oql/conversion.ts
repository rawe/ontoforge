/**
 * Result conversion — the compile-time plan, applied after the door.
 *
 * Rows come back in `rowMode: "array"` and are folded into the port's
 * `Row` map here; duplicate column names collapse onto the last value,
 * matching what the reference adapter's per-column `record.get` loop
 * does. The `ColumnConversion` plan is built at compile time, from
 * schema knowledge the runtime no longer has:
 *
 * - `count(*)` and other int8 columns arrive from `pg` as strings →
 *   `Number()`.
 * - Schema-declared datetime properties and `_createdAt`/`_updatedAt`
 *   → JS `Date`, recursing through lists.
 * - Everything else is already the port's value: the projection form is
 *   raw jsonb, which the driver parses back.
 *
 * Known and accepted: `timestamptz` inside jsonb keeps microseconds and
 * a JS `Date` truncates to milliseconds — the same loss the reference
 * driver's own conversion has, so the wire forms stay identical.
 */

import type { Row } from "../../../core/ports.js";

export type ColumnConversion =
  | { kind: "entity" | "relation"; typeKey: string | null; datetimeKeys: readonly string[] }
  | { kind: "number" }
  | { kind: "datetime" }
  | { kind: "none" };

/** Array-mode rows → the port's `[columns, rows]` row maps. */
export function convertRows(
  plan: { columns: readonly string[]; conversions: readonly ColumnConversion[] },
  rows: readonly unknown[][],
): Row[] {
  return rows.map((values) => {
    const row: Row = {};
    plan.columns.forEach((name, index) => {
      row[name] = convertValue(values[index], plan.conversions[index]!);
    });
    return row;
  });
}

function convertValue(value: unknown, conversion: ColumnConversion): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((element) => convertValue(element, conversion));
  }
  switch (conversion.kind) {
    case "number":
      return Number(value);
    case "datetime":
      return value instanceof Date ? value : new Date(String(value));
    case "entity":
    case "relation": {
      if (typeof value !== "object") {
        return value;
      }
      const object: Row = { ...(value as Row) };
      for (const key of conversion.datetimeKeys) {
        const stored = object[key];
        if (typeof stored === "string") {
          object[key] = new Date(stored);
        }
      }
      return object;
    }
    default:
      return value;
  }
}
