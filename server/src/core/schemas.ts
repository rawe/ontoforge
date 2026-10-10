/**
 * Core schema vocabulary shared by modeling and runtime: the data-type
 * enumeration, the key patterns, the owner-kind discriminator, and the
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
 * Key rule of the schema level — ontologies, entity and relation types,
 * properties, lenses, search indices: lower snake case, starting with a
 * letter. No hyphen, because these keys appear as OQL identifiers (`-` reads
 * as minus) and in storage names. The leading-letter requirement is
 * load-bearing — system properties carry a leading underscore, so no user key
 * can ever collide with one.
 */
export const SCHEMA_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Key rule of the lens-resource level — saved queries and assistants of every
 * kind: the schema rule plus `-`. These keys travel only in URLs, JSON and
 * tool arguments, never into OQL or storage names, so a hyphen is harmless.
 */
export const LENS_RESOURCE_KEY_PATTERN = /^[a-z][a-z0-9_-]*$/;

/**
 * Maximum length for every key kind — entity type, relation type, lens,
 * property, agent, saved query. Boundary hygiene, not a physical limit: an
 * absurd key dies as a clean 422 at validation instead of deep inside
 * adapter DDL, and derived physical names stay legible.
 */
export const MAX_KEY_LENGTH = 64;

/**
 * Ontology keys are capped tighter than the general key rule: an adapter
 * derives a physical namespace name from the key, and the longest such
 * derivation must stay a legal identifier everywhere (PostgreSQL truncates
 * identifiers at 63, and `ont_` + 59 is exactly that).
 */
export const MAX_ONTOLOGY_KEY_LENGTH = 59;

/**
 * The two kinds of schema type that can own a property definition or be
 * included in a lens's scope. These exact values are the port's
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

/**
 * Every entity type has exactly one name property: a `string` property of
 * that type, designated in modeling. Creating an entity type creates it,
 * keyed `name` unless the request names another key.
 */
export const DEFAULT_NAME_PROPERTY = "name";

/** The data type a name property must have. */
export const NAME_PROPERTY_DATA_TYPE = "string";

/** Display name of a created name property: "Name" for `name`, otherwise the key. */
export function namePropertyDisplayName(key: string): string {
  return key === DEFAULT_NAME_PROPERTY ? "Name" : key;
}

/** A property definition to create together with its entity type. */
export interface NewPropertyDef {
  propertyId: string;
  key: string;
  displayName: string;
  description: string | null;
  dataType: string;
  required: boolean;
  defaultValue: string | null;
}
