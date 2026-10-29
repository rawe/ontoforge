/**
 * Entity identity (`docs/capabilities/entity-identity.md`): the text form
 * of an entity's identity and the checks on its values, pure.
 *
 * The identity is the identity properties' stored (coerced) values, in
 * the declared order, joined with `~`. A `string` value writes `%` as
 * `%25` and `~` as `%7E`, always, so the join is never ambiguous; an
 * `integer` is plain decimal; a `date` its `YYYY-MM-DD`. No trimming and
 * no case folding: two identities are equal only character for
 * character. The service computes the identity on every write and hands
 * it to the store, which never builds one.
 */

import { cpLength } from "./codePoints.js";

/** The data types an identity property may have. */
export const IDENTITY_DATA_TYPES: readonly string[] = ["string", "integer", "date"];

/** At most this many properties make up an identity. */
export const MAX_IDENTITY_PROPERTIES = 5;

/** The longest identity, in Unicode code points. */
export const MAX_IDENTITY_LENGTH = 512;

/** The system property an entity's identity is read under. */
export const IDENTITY_FIELD = "_identity";

/** Joins the parts of an identity. */
const SEPARATOR = "~";

type Row = Record<string, unknown>;

/** One identity property: its key and data type. */
export interface IdentityProperty {
  key: string;
  dataType: string;
}

/** One value's part of the text form; null when the value cannot be one
 * (absent, empty, or not of the data type). */
function part(value: unknown, dataType: string): string | null {
  if (value === null || value === undefined) return null;
  switch (dataType) {
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value) ? String(value) : null;
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    default:
      if (typeof value !== "string" || value === "") return null;
      return value.replaceAll("%", "%25").replaceAll("~", "%7E");
  }
}

/** The faults of an entity's identity values, by property key: an
 * absent or empty value, and — on every identity property — a joined
 * identity over the length limit. */
export type IdentityFaults = Record<string, string>;

/** The fault of an empty string as an identity property value. */
export const EMPTY_IDENTITY_VALUE = "An identity property cannot be an empty string";

/** The fault of a joined identity over `MAX_IDENTITY_LENGTH`. */
export const IDENTITY_TOO_LONG = `The identity is longer than ${MAX_IDENTITY_LENGTH} characters`;

/** The fault of an identity property without a value. */
export const IDENTITY_VALUE_MISSING = "Required property missing";

/**
 * The identity of an entity whose values are `values` (the entity as it
 * will be stored), or its faults. An empty string is refused under its
 * property; a missing value too, which only a type's validation can
 * otherwise let through (a lens hiding the property); the length limit
 * under every identity property.
 */
export function buildIdentity(
  properties: readonly IdentityProperty[],
  values: Row,
): { identity: string; faults: null } | { identity: null; faults: IdentityFaults } {
  const faults: IdentityFaults = {};
  const parts: string[] = [];
  for (const property of properties) {
    const value = values[property.key];
    const text = part(value, property.dataType);
    if (text === null) {
      faults[property.key] = value === "" ? EMPTY_IDENTITY_VALUE : IDENTITY_VALUE_MISSING;
      continue;
    }
    parts.push(text);
  }
  if (Object.keys(faults).length > 0) return { identity: null, faults };
  const identity = parts.join(SEPARATOR);
  if (cpLength(identity) > MAX_IDENTITY_LENGTH) {
    return {
      identity: null,
      faults: Object.fromEntries(properties.map((property) => [property.key, IDENTITY_TOO_LONG])),
    };
  }
  return { identity, faults: null };
}

/** The identity properties of a type, with their data types; null when
 * the type has no identity (or a listed property is missing from
 * `defs`, which a lens hiding one leads to). */
export function identityPropertiesOf(
  identityProperties: readonly string[] | null,
  defs: Record<string, { dataType: string }>,
): IdentityProperty[] | null {
  if (identityProperties === null) return null;
  const properties: IdentityProperty[] = [];
  for (const key of identityProperties) {
    const def = defs[key];
    if (def === undefined) return null;
    properties.push({ key, dataType: def.dataType });
  }
  return properties;
}

/** The values an identity is built from, by property key: the text form
 * split back into its parts; null when no values build exactly it. */
export function identityValues(properties: readonly IdentityProperty[], identity: string): Row | null {
  const parts = identity.split(SEPARATOR);
  if (parts.length !== properties.length) return null;
  const values: Row = {};
  properties.forEach((property, i) => {
    const text = parts[i]!;
    values[property.key] =
      property.dataType === "integer"
        ? /^-?\d+$/.test(text) ? Number(text) : null
        : property.dataType === "date"
          ? text
          : text.replace(/%25|%7E/g, (escape) => (escape === "%25" ? "%" : "~"));
  });
  return buildIdentity(properties, values).identity === identity ? values : null;
}
