/**
 * Data-type coercion for the runtime write path and the list-filter path.
 *
 * Coercion is strict: values are converted, never guessed
 * (`docs/capabilities/schema-modeling.md#data-types`). Two rules do not
 * follow from the table and are checked here explicitly:
 *
 * - A boolean is not a number: `true` is rejected for integer and float,
 *   never coerced to 1.
 * - Temporals are real values, not text: `date` coerces to a validated ISO
 *   `YYYY-MM-DD` string (the port-safe calendar-date form, see
 *   `adapters/neo4j/temporal.ts`), `datetime` to a JS `Date`; a naive
 *   datetime (no offset) is treated as UTC.
 *
 * The two halves of a rejection message speak two different type systems,
 * deliberately. The expected half names an OntoForge data type, because
 * that is what the schema declared. The received half names the JSON type
 * of what arrived, because what arrived is a JSON value. Neither names a
 * type as this server's implementation language spells it: the text
 * surfaces verbatim in `details.fields` of validation errors, and a caller
 * is never told what the server is written in (`docs/decisions.md`).
 */

/** A value that cannot be coerced. Callers catch this and collect the
 * message as a field error. */
export class CoercionError extends Error {}

/** The JSON type name of a received value — used in error text. */
function jsonTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// ISO date-time: date part, optional time (T or space separator), optional
// fractional seconds, optional offset.
const DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?)?$/;

/** Parse a strict ISO calendar date; returns the normalized string. */
function parseIsoDate(value: string, key: string): string {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    throw new CoercionError(`Expected ISO date for '${key}', got '${value}'`);
  }
  const [, y, m, d] = match as unknown as [string, string, string, string];
  if (!isRealCalendarDate(Number(y), Number(m), Number(d))) {
    throw new CoercionError(`Expected ISO date for '${key}', got '${value}'`);
  }
  return value;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Parse an ISO date-time; a missing offset means UTC. */
function parseIsoDateTime(value: string, key: string): Date {
  const match = DATETIME_PATTERN.exec(value);
  if (!match) {
    throw new CoercionError(`Expected ISO datetime for '${key}', got '${value}'`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const fraction = match[7] ?? "";
  const offset = match[8];

  if (
    !isRealCalendarDate(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new CoercionError(`Expected ISO datetime for '${key}', got '${value}'`);
  }

  const millis = fraction === "" ? 0 : Number(`0.${fraction}`) * 1000;

  let offsetMinutes = 0;
  if (offset !== undefined && offset.toUpperCase() !== "Z") {
    const sign = offset.startsWith("-") ? -1 : 1;
    const digits = offset.slice(1).replace(":", "");
    const offsetHours = Number(digits.slice(0, 2));
    const offsetMins = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    if (offsetHours > 23 || offsetMins > 59) {
      throw new CoercionError(`Expected ISO datetime for '${key}', got '${value}'`);
    }
    offsetMinutes = sign * (offsetHours * 60 + offsetMins);
  }

  const epoch =
    Date.UTC(year, month - 1, day, hour, minute, second) +
    Math.round(millis) -
    offsetMinutes * 60_000;
  return new Date(epoch);
}

/**
 * Render a value as text — in JSON's spelling, since JSON is what arrives.
 *
 * This is the single answer to "what does this value look like as text",
 * and every caller uses it: what a `string` property stores, what a filter
 * value is compared as, what a saved-query parameter substitutes to. Those
 * have to agree character for character — a boolean stored as text and the
 * same boolean searched for as text must produce the same characters — so
 * they share one function rather than each spelling it out.
 */
export function valueToText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

const INTEGER_PATTERN = /^[+-]?\d+$/;

/**
 * Coerce a JSON value to its declared data type, or throw `CoercionError`.
 *
 * `date` yields a validated ISO `YYYY-MM-DD` string; `datetime` a JS
 * `Date`; the persistence adapter converts both to its native temporal
 * types on write.
 */
export function coerceValue(value: unknown, dataType: string, key: string): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  switch (dataType) {
    case "string":
    case "document":
      return valueToText(value);

    case "integer": {
      if (typeof value === "number") {
        if (Number.isInteger(value)) {
          return value;
        }
        // JSON has one number type, so naming it would say nothing. The
        // rejected value itself is what the caller needs to see.
        throw new CoercionError(`Expected integer for '${key}', got '${value}'`);
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (INTEGER_PATTERN.test(trimmed)) {
          return Number.parseInt(trimmed, 10);
        }
        throw new CoercionError(`Expected integer for '${key}', got '${value}'`);
      }
      throw new CoercionError(`Expected integer for '${key}', got ${jsonTypeName(value)}`);
    }

    case "float": {
      if (typeof value === "number") {
        return value;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        const parsed = trimmed === "" ? Number.NaN : Number(trimmed);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
        throw new CoercionError(`Expected float for '${key}', got '${value}'`);
      }
      throw new CoercionError(`Expected float for '${key}', got ${jsonTypeName(value)}`);
    }

    case "boolean": {
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "string") {
        if (value.toLowerCase() === "true") return true;
        if (value.toLowerCase() === "false") return false;
        throw new CoercionError(`Expected boolean for '${key}', got '${value}'`);
      }
      throw new CoercionError(
        `Expected boolean for '${key}', got ${jsonTypeName(value)}`,
      );
    }

    case "date": {
      if (typeof value === "string") {
        return parseIsoDate(value, key);
      }
      throw new CoercionError(
        `Expected ISO date string for '${key}', got ${jsonTypeName(value)}`,
      );
    }

    case "datetime": {
      if (typeof value === "string") {
        return parseIsoDateTime(value, key);
      }
      throw new CoercionError(
        `Expected ISO datetime string for '${key}', got ${jsonTypeName(value)}`,
      );
    }

    default:
      throw new CoercionError(`Unknown data type '${dataType}' for '${key}'`);
  }
}
