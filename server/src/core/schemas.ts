/**
 * Core schema vocabulary shared by modeling and runtime: the data-type
 * enumeration and the key pattern.
 */

/** The seven data types a property definition can declare. */
export const DATA_TYPES = [
  "string",
  "integer",
  "float",
  "boolean",
  "date",
  "datetime",
  "document",
] as const;

export type DataType = (typeof DATA_TYPES)[number];

/**
 * Type keys and property keys: lower snake case, starting with a letter.
 * The leading-letter requirement is load-bearing — system properties carry
 * a leading underscore, so no user key can ever collide with one.
 */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
