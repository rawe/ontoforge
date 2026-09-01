/**
 * Shared unit-test builders: a minimal `PropertyDef`, a parsed property
 * `FilterCondition` and a resolved path condition in their tagged forms,
 * and the canonical one-property-per-data-type DEFS map the filter and
 * encoding tests exercise.
 */

import type { FilterCondition, PathFilterCondition } from "../src/core/ports.js";
import type { PropertyDef } from "../src/core/schemas.js";

export function prop(key: string, dataType: string): PropertyDef {
  return { key, displayName: key, description: null, dataType, required: false, defaultValue: null };
}

export function cond(
  propertyKey: string,
  dataType: string,
  op: FilterCondition["op"],
  value: unknown,
): FilterCondition {
  return { kind: "property", propertyKey, dataType, op, value };
}

/** A resolved path condition — to a property of the related entity unless
 * `propertySource` names the relation itself. */
export function pathCond(
  relationTypeKey: string,
  direction: PathFilterCondition["direction"],
  propertyKey: string,
  dataType: string,
  op: FilterCondition["op"],
  value: unknown,
  propertySource: PathFilterCondition["propertySource"] = "relatedEntity",
): PathFilterCondition {
  return {
    kind: "path",
    relationTypeKey,
    direction,
    propertySource,
    propertyKey,
    dataType,
    op,
    value,
  };
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
