/**
 * Core schema vocabulary shared by modeling and runtime: the data-type
 * enumeration, the key pattern, the owner-kind discriminator, and the
 * property-definition shape.
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

/**
 * The two kinds of schema type that can own a property definition or be
 * included in an ontology's scope. These exact values are the port's
 * owner-kind vocabulary (normative); the MCP wire values
 * `entity_type`/`relation_type` are a separate, fixed spelling.
 */
export type TypeKind = "EntityType" | "RelationType";

/** One property definition as the runtime consumes it. */
export interface PropertyDef {
  key: string;
  displayName: string;
  description: string | null;
  dataType: string;
  required: boolean;
  defaultValue: string | null;
}
