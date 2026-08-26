/**
 * Shared unit-test builders: a minimal `PropertyDef`, a parsed
 * `FilterCondition`, and the canonical one-property-per-data-type DEFS
 * map the filter and encoding tests exercise.
 */

import type { FilterCondition } from "../src/core/ports.js";
import type { PropertyDef } from "../src/core/schemas.js";

export function prop(key: string, dataType: string): PropertyDef {
  return { key, displayName: key, description: null, dataType, required: false, defaultValue: null };
}

export function cond(
  key: string,
  dataType: string,
  op: FilterCondition["op"],
  value: unknown,
): FilterCondition {
  return { key, dataType, op, value };
}

export const DEFS: Record<string, PropertyDef> = {
  name: prop("name", "string"),
  age: prop("age", "integer"),
  score: prop("score", "float"),
  active: prop("active", "boolean"),
  founded: prop("founded", "date"),
  seen_at: prop("seen_at", "datetime"),
  bio: prop("bio", "document"),
};
