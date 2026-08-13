/**
 * Temporal conversion at the persistence-port boundary.
 *
 * Port contract rule 1: temporal values cross the port as JS `Date` objects
 * (datetimes) or ISO `YYYY-MM-DD` strings (dates) — never as neo4j-driver
 * types. These helpers are the single place the conversion happens, in both
 * directions; every store method uses them.
 *
 * Naive driver datetimes (no timezone) are treated as UTC.
 */

import neo4j from "neo4j-driver";
import type {
  Date as Neo4jDateGeneric,
  DateTime as Neo4jDateTimeGeneric,
  LocalDateTime as Neo4jLocalDateTimeGeneric,
} from "neo4j-driver";

type Neo4jDateTime = Neo4jDateTimeGeneric<number>;
type Neo4jLocalDateTime = Neo4jLocalDateTimeGeneric<number>;
type Neo4jDate = Neo4jDateGeneric<number>;

function isNeo4jDateTime(value: unknown): value is Neo4jDateTime {
  return value instanceof neo4j.types.DateTime;
}

function isNeo4jLocalDateTime(value: unknown): value is Neo4jLocalDateTime {
  return value instanceof neo4j.types.LocalDateTime;
}

function isNeo4jDate(value: unknown): value is Neo4jDate {
  return value instanceof neo4j.types.Date;
}

/** Convert one driver value to its port-safe form. Recurses into arrays and
 * plain objects so nothing driver-shaped survives at any depth. */
export function fromNeo4jValue(value: unknown): unknown {
  if (isNeo4jDateTime(value)) {
    // toStandardDate() interprets a missing offset as UTC-relative via the
    // driver; the result is a JS Date, which is inherently UTC-based.
    return value.toStandardDate();
  }
  if (isNeo4jLocalDateTime(value)) {
    // A stored local (offset-less) datetime is treated as UTC: the read
    // conversion stamps UTC onto any datetime carrying no timezone.
    return new Date(
      Date.UTC(
        value.year,
        value.month - 1,
        value.day,
        value.hour,
        value.minute,
        value.second,
        Math.round(value.nanosecond / 1_000_000),
      ),
    );
  }
  if (isNeo4jDate(value)) {
    // A calendar date has no time component; its port form is the ISO
    // `YYYY-MM-DD` string.
    return value.toString();
  }
  if (neo4j.isInt(value)) {
    return value.toNumber();
  }
  if (Array.isArray(value)) {
    return value.map(fromNeo4jValue);
  }
  if (value !== null && typeof value === "object" && value.constructor === Object) {
    return convertNeo4jProperties(value as Record<string, unknown>);
  }
  return value;
}

/** Convert a property map returned by the driver to port-safe values. */
export function convertNeo4jProperties(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = fromNeo4jValue(value);
  }
  return result;
}

/** Convert a JS `Date` to the driver's zoned datetime type (UTC). */
export function toNeo4jDateTime(value: Date): Neo4jDateTime {
  return neo4j.types.DateTime.fromStandardDate(value);
}

/** Convert an ISO `YYYY-MM-DD` string to the driver's date type. */
export function toNeo4jDate(value: string): Neo4jDate {
  const [year = 0, month = 0, day = 0] = value
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  return new neo4j.types.Date<number>(year, month, day);
}
