/**
 * Entities as people and models read them: a label from the type's name
 * property, a few visible fields by display name, values as short text.
 * Only what the lens shows; document properties never (they are passages,
 * not fields).
 */

import type { Row } from "../../../core/ports.js";
import type { EntityTypeDef } from "../../schemaCache.js";

/** Fields one card carries at most. */
export const CARD_FIELDS = 6;

/** Characters of one field value. */
export const FIELD_CHARACTERS = 200;

function short(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/** The entity's label: its name property's value, else its id. */
export function entityLabel(entity: Row, type: EntityTypeDef): string {
  const name = type.nameProperty === null ? null : asText(entity[type.nameProperty]);
  return name ?? String(entity._id);
}

/** Up to `CARD_FIELDS` visible, non-document, non-name fields with a value, in schema order. */
export function entityFields(entity: Row, type: EntityTypeDef): { name: string; value: string }[] {
  const fields: { name: string; value: string }[] = [];
  for (const property of Object.values(type.properties)) {
    if (fields.length === CARD_FIELDS) break;
    if (property.dataType === "document" || property.key === type.nameProperty) continue;
    const value = asText(entity[property.key]);
    if (value !== null) fields.push({ name: property.displayName, value: short(value, FIELD_CHARACTERS) });
  }
  return fields;
}
