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
import type { ValidatedQuery } from "../../../core/oql/index.js";
import { typeDefinition, type TableBinding } from "./bindings.js";

export type ColumnConversion =
  | { kind: "entity" | "relation"; typeKey: string | null; datetimeKeys: readonly string[] }
  | { kind: "number" }
  | { kind: "datetime" }
  | { kind: "none" };

/** The plan for a projected node or relationship: its type's declared
 * datetime properties, plus the two system timestamps. */
export function objectConversion(
  schema: ValidatedQuery["schema"],
  binding: TableBinding,
): ColumnConversion {
  const { kind, typeKey } = binding;
  const declared = Object.values(typeDefinition(schema, binding)?.properties ?? {})
    .filter((property) => property.dataType === "datetime")
    .map((property) => property.key)
    .sort();
  return { kind, typeKey, datetimeKeys: ["_createdAt", "_updatedAt", ...declared] };
}

/** The plan for a scalar column of a known declared data type. The
 * projection form is raw jsonb, which the driver already parses back —
 * only datetimes need rebuilding into a JS `Date`. */
export function scalarConversion(dataType: string | null): ColumnConversion {
  return dataType === "datetime" ? { kind: "datetime" } : { kind: "none" };
}

/**
 * The plan for an aggregate column. `pg` hands back `int8` and `numeric`
 * as strings, so every numeric aggregate is folded to a JS number; a
 * `min`/`max` over a temporal cast already arrives as a `Date`.
 */
export function aggregateConversion(dataType: string | null): ColumnConversion {
  if (dataType === "integer" || dataType === "float") {
    return { kind: "number" };
  }
  if (dataType === "datetime" || dataType === "date") {
    return { kind: "datetime" };
  }
  return { kind: "none" };
}

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
