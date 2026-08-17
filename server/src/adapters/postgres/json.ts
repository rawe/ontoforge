/**
 * Value encoding between port forms and jsonb `props` values.
 *
 * Only datetime is non-JSON-native at the port: it crosses as a JS
 * `Date` and is stored as its `toISOString()` text (always an explicit
 * `Z` offset, so the `::timestamptz` read-back is session-timezone-
 * independent). Every other declared type already IS the native jsonb
 * value and passes through untouched — as do keys without a definition,
 * such as the service's `_doc_<key>_length` counters. The service
 * resolves all nulls above the port, so neither direction ever sees a
 * null property value.
 */

import type { Row } from "../../core/ports.js";
import type { PropertyDef } from "../../core/schemas.js";

/** Port property map → the object stored as jsonb (write direction). */
export function toJson(properties: Row, propertyDefs: Record<string, PropertyDef>): Row {
  const converted: Row = {};
  for (const [key, value] of Object.entries(properties)) {
    converted[key] =
      propertyDefs[key]?.dataType === "datetime" && value instanceof Date
        ? value.toISOString()
        : value;
  }
  return converted;
}

/** Parsed jsonb object → the port property map (read direction). */
export function fromJson(properties: Row, propertyDefs: Record<string, PropertyDef>): Row {
  const converted: Row = {};
  for (const [key, value] of Object.entries(properties)) {
    converted[key] =
      propertyDefs[key]?.dataType === "datetime" && typeof value === "string"
        ? new Date(value)
        : value;
  }
  return converted;
}
