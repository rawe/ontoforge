/**
 * The name-property fallback for data written before name properties
 * existed (storage below version 3, transfer format 5.0). It exists for
 * 5.x data only: the storage upgrade, the 5.0 import and the Neo4j boot
 * backfill call it, nothing else — remove it with them.
 */

import { DEFAULT_NAME_PROPERTY, NAME_PROPERTY_DATA_TYPE } from "./schemas.js";

/** Preferred keys, in order; after them the first string property wins. */
const PREFERRED_KEYS = ["name", "title", "label", "display_name"];

/** What the fallback reads of one property. */
export interface LegacyProperty {
  key: string;
  dataType: string;
}

/**
 * The name property of an entity type whose properties are given in
 * declaration order: the first string property among `name`, `title`,
 * `label`, `display_name` (in that order), else the first string property.
 * A type without any string property gets a new one — `create` is true and
 * `key` is `name`, or `name_2`, `name_3`, … when `name` is taken; the
 * caller creates it as a non-required string property.
 */
export function legacyNameProperty(properties: readonly LegacyProperty[]): {
  key: string;
  create: boolean;
} {
  const strings = properties.filter((p) => p.dataType === NAME_PROPERTY_DATA_TYPE);
  for (const preferred of PREFERRED_KEYS) {
    if (strings.some((p) => p.key === preferred)) {
      return { key: preferred, create: false };
    }
  }
  if (strings[0] !== undefined) {
    return { key: strings[0].key, create: false };
  }
  const taken = new Set(properties.map((p) => p.key));
  let key = DEFAULT_NAME_PROPERTY;
  for (let suffix = 2; taken.has(key); suffix++) {
    key = `${DEFAULT_NAME_PROPERTY}_${suffix}`;
  }
  return { key, create: true };
}
