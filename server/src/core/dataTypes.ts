/**
 * Data-type coercion for the runtime write path and the list-filter path.
 *
 * Ports `coerce_value` from the Python reference (`runtime/service.py`).
 * Coercion is strict: values are converted, never guessed
 * (`docs/capabilities/schema-modeling.md#data-types`). Two rules do not
 * follow from the table and are checked here explicitly:
 *
 * - A boolean is not a number: `true` is rejected for integer and float
 *   BEFORE any numeric conversion.
 * - Temporals are real values, not text: `date` coerces to a validated ISO
 *   `YYYY-MM-DD` string (the port-safe calendar-date form, see
 *   `adapters/neo4j/temporal.ts`), `datetime` to a JS `Date`; a naive
 *   datetime (no offset) is treated as UTC.
 *
 * Error messages mirror the Python reference, including its type names
 * (`str`, `int`, `float`, `bool`, `list`, `dict`), because they surface
 * verbatim in `details.fields` of validation errors.
 */

/** A value that cannot be coerced. Callers catch this and collect the
 * message as a field error — mirroring Python's `ValueError`. */
export class CoercionError extends Error {}

/** The Python type name a JSON value would carry — used in error text. */
function pythonTypeName(value: unknown): string {
  if (Array.isArray(value)) return "list";
  switch (typeof value) {
    case "string":
      return "str";
    case "boolean":
      return "bool";
    case "number":
      return Number.isInteger(value) ? "int" : "float";
    case "object":
      return "dict";
    default:
      return typeof value;
  }
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// ISO date-time: date part, optional time (T or space separator), optional
// fractional seconds, optional offset — the common subset of what Python's
// `datetime.fromisoformat` accepts.
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

/** Python `str()` for the JSON values a string property can receive. */
function stringify(value: unknown): string {
  // Python's `str(True)` is "True"; preserved for parity, since the stored
  // value is what every later read returns.
  if (typeof value === "boolean") return value ? "True" : "False";
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
      return stringify(value);

    case "integer": {
      if (typeof value === "boolean") {
        throw new CoercionError(`Expected integer for '${key}', got boolean`);
      }
      if (typeof value === "number" && Number.isInteger(value)) {
        return value;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (INTEGER_PATTERN.test(trimmed)) {
          return Number.parseInt(trimmed, 10);
        }
        throw new CoercionError(`Expected integer for '${key}', got '${value}'`);
      }
      throw new CoercionError(
        `Expected integer for '${key}', got ${pythonTypeName(value)}`,
      );
    }

    case "float": {
      if (typeof value === "boolean") {
        throw new CoercionError(`Expected float for '${key}', got boolean`);
      }
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
      throw new CoercionError(`Expected float for '${key}', got ${pythonTypeName(value)}`);
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
        `Expected boolean for '${key}', got ${pythonTypeName(value)}`,
      );
    }

    case "date": {
      if (typeof value === "string") {
        return parseIsoDate(value, key);
      }
      throw new CoercionError(
        `Expected ISO date string for '${key}', got ${pythonTypeName(value)}`,
      );
    }

    case "datetime": {
      if (typeof value === "string") {
        return parseIsoDateTime(value, key);
      }
      throw new CoercionError(
        `Expected ISO datetime string for '${key}', got ${pythonTypeName(value)}`,
      );
    }

    default:
      throw new CoercionError(`Unknown data type '${dataType}' for '${key}'`);
  }
}
