/**
 * Query paths — filter keys that cross exactly one relation type to a
 * property of the related entity (`<relationTypeKey>.<propertyKey>`) or
 * to a property stored on the relation itself
 * (`<relationTypeKey>@<propertyKey>`). The relation segment may carry a
 * direction marker, `:out` or `:in`.
 *
 * Resolution happens here, above the persistence port, against the
 * lens-scoped schema: the relation type must be exposed and touch the
 * listed entity type; the direction follows from which endpoint the
 * listed type is — a marker must agree with it, and on a self-relation,
 * where the listed type is both endpoints, the marker is what settles
 * it and is required; and the final property must be exposed on the
 * related entity type or on the relation type. What the lens hides fails exactly
 * as what does not exist. A resolved path becomes the port's
 * `PathFilterCondition`; a fault is returned, not thrown, so the filter
 * parser can collect it with the faults of every other key.
 */

import type { PathFilterCondition } from "../core/ports.js";
import type { PropertyDef } from "../core/schemas.js";
import type { SchemaCacheValue } from "./schemaCache.js";

/** The segment separators — `.` for a property of the related entity,
 * `@` for a property of the relation itself. No schema key may contain
 * either, so a key that does is a query path and never a property key. */
const RELATED_ENTITY_SEPARATOR = ".";
const RELATION_SEPARATOR = "@";
const PATH_SEPARATORS = new RegExp(`[${RELATED_ENTITY_SEPARATOR}${RELATION_SEPARATOR}]`);

/** Whether a filter or sort key (operator suffix already removed) is a
 * query path rather than a property key. */
export function isQueryPath(key: string): boolean {
  return PATH_SEPARATORS.test(key);
}

type Direction = PathFilterCondition["direction"];

/** The direction marker a relation segment may carry, per direction:
 * `manages:out` follows the relation from the listed entity, `manages:in`
 * to it. No schema key may contain a colon. */
const DIRECTION_MARKERS: Record<Direction, string> = { outgoing: ":out", incoming: ":in" };

/** Split a relation segment into the relation type key and the direction
 * its marker names, if it carries one. Only the two markers are
 * recognised; any other text after a colon stays part of the key, so
 * the segment fails as an unknown first segment. */
function splitRelationSegment(segment: string): { relationTypeKey: string; marker?: Direction } {
  for (const direction of ["outgoing", "incoming"] as const) {
    const marker = DIRECTION_MARKERS[direction];
    if (segment.endsWith(marker) && segment.length > marker.length) {
      return { relationTypeKey: segment.slice(0, -marker.length), marker: direction };
    }
  }
  return { relationTypeKey: segment };
}

/** A resolved path: everything the port condition carries except the
 * comparison, plus the final property definition the value is coerced by. */
export interface ResolvedQueryPath {
  relationTypeKey: string;
  direction: Direction;
  propertySource: PathFilterCondition["propertySource"];
  propertyKey: string;
  propertyDef: PropertyDef;
}

/** One rejected path: the caller-facing message and the per-key detail. */
export interface QueryPathFault {
  message: string;
  detail: string;
}

/** Sorted keys as one comma-separated hint; `none` when there are none. */
function keyList(keys: string[]): string {
  return keys.length === 0 ? "none" : [...keys].sort().join(", ");
}

/** The relation types a path from the listed type may cross: exposed
 * through the lens, touching the listed type as source or target, with
 * the entity type at the other end exposed too — a lens may include a
 * relation type without its endpoint types, and a path through one whose
 * related type is hidden must fail as if the relation type did not exist. */
function crossableRelationTypeKeys(listedTypeKey: string, scoped: SchemaCacheValue): string[] {
  return Object.values(scoped.relationTypes)
    .filter((rt) => {
      const touches = rt.fromEntityTypeKey === listedTypeKey || rt.toEntityTypeKey === listedTypeKey;
      const relatedTypeKey =
        rt.fromEntityTypeKey === listedTypeKey ? rt.toEntityTypeKey : rt.fromEntityTypeKey;
      return touches && relatedTypeKey in scoped.entityTypes;
    })
    .map((rt) => rt.key);
}

/** The fault for a first segment that names nothing crossable from the
 * listed type: not one of its properties, not a relation type the path
 * may cross. */
function unknownFirstSegment(
  segment: string,
  listedTypeKey: string,
  scoped: SchemaCacheValue,
): QueryPathFault {
  return {
    message: `Unknown filter property or relation type: '${segment}'`,
    detail:
      `Not defined in type '${listedTypeKey}'. ` +
      `Property keys: ${keyList(Object.keys(scoped.entityTypes[listedTypeKey]?.properties ?? {}))}. ` +
      `Relation types touching '${listedTypeKey}': ` +
      keyList(crossableRelationTypeKeys(listedTypeKey, scoped)),
  };
}

/**
 * Resolve one query path for the entity type being listed. Returns the
 * resolved path or the first fault found, in this order: too many
 * segments, unknown first segment (a relation type whose related entity
 * type the lens hides counts as unknown, for either form, and so does
 * unrecognised marker text), relation type not touching the listed type,
 * self-relation without a marker, marker contradicting the derivable
 * direction, unknown final property on its owner — the related entity
 * type for `.`, the relation type for `@` — and document-typed final
 * property.
 */
export function resolveQueryPath(
  path: string,
  listedTypeKey: string,
  scoped: SchemaCacheValue,
): ResolvedQueryPath | QueryPathFault {
  const segments = path.split(PATH_SEPARATORS);
  if (segments.length > 2) {
    return {
      message: `Query path '${path}' crosses more than one relation`,
      detail:
        "A filter key may cross exactly one relation type: " +
        "<relationTypeKey>.<propertyKey> or <relationTypeKey>@<propertyKey>",
    };
  }
  const [relationSegment, propertyKey] = segments as [string, string];
  const { relationTypeKey, marker } = splitRelationSegment(relationSegment);
  const propertySource: ResolvedQueryPath["propertySource"] = path.includes(RELATION_SEPARATOR)
    ? "relation"
    : "relatedEntity";
  const relationType = scoped.relationTypes[relationTypeKey];
  if (relationType === undefined) {
    return unknownFirstSegment(relationTypeKey, listedTypeKey, scoped);
  }
  const isSource = relationType.fromEntityTypeKey === listedTypeKey;
  const isTarget = relationType.toEntityTypeKey === listedTypeKey;
  if (!isSource && !isTarget) {
    return {
      message: `Relation type '${relationTypeKey}' does not touch entity type '${listedTypeKey}'`,
      detail:
        `'${relationTypeKey}' connects '${relationType.fromEntityTypeKey}' ` +
        `to '${relationType.toEntityTypeKey}'. ` +
        `Relation types touching '${listedTypeKey}': ` +
        keyList(crossableRelationTypeKeys(listedTypeKey, scoped)),
    };
  }
  // The direction the endpoints derive — none when the listed type is both.
  const derived: Direction | undefined =
    isSource && isTarget ? undefined : isSource ? "outgoing" : "incoming";
  const separator = propertySource === "relation" ? RELATION_SEPARATOR : RELATED_ENTITY_SEPARATOR;
  const withMarker = (direction: Direction): string =>
    `${relationTypeKey}${DIRECTION_MARKERS[direction]}${separator}${propertyKey}`;
  let direction: Direction;
  if (marker === undefined) {
    if (derived === undefined) {
      return {
        message: `Query path '${path}' needs a direction marker`,
        detail:
          `'${relationTypeKey}' connects '${listedTypeKey}' to '${listedTypeKey}', ` +
          `so the direction cannot be derived; write '${withMarker("outgoing")}' ` +
          `or '${withMarker("incoming")}'`,
      };
    }
    direction = derived;
  } else {
    if (derived !== undefined && marker !== derived) {
      return {
        message: `Query path '${path}' contradicts the derivable direction`,
        detail:
          `'${relationTypeKey}' connects '${relationType.fromEntityTypeKey}' ` +
          `to '${relationType.toEntityTypeKey}', so from '${listedTypeKey}' it is followed ` +
          `${derived}: write '${withMarker(derived)}' or omit the marker`,
      };
    }
    direction = marker;
  }
  const relatedTypeKey =
    direction === "outgoing" ? relationType.toEntityTypeKey : relationType.fromEntityTypeKey;
  const relatedType = scoped.entityTypes[relatedTypeKey];
  if (relatedType === undefined) {
    return unknownFirstSegment(relationTypeKey, listedTypeKey, scoped);
  }
  // The final property's owner: the relation type for the `@` form, the
  // related entity type for the `.` form.
  const [owner, ownerKind] =
    propertySource === "relation"
      ? [relationType, "relation type"]
      : [relatedType, "related entity type"];
  const propertyDef = owner.properties[propertyKey];
  if (propertyDef === undefined) {
    return {
      message: `Unknown filter property: '${propertyKey}' on ${ownerKind} '${owner.key}'`,
      detail:
        `Not defined in type '${owner.key}'. ` +
        `Property keys: ${keyList(Object.keys(owner.properties))}`,
    };
  }
  if (propertyDef.dataType === "document") {
    return {
      message: `Query path '${path}' ends in a document property`,
      detail:
        `'${propertyKey}' on '${owner.key}' is a document property; ` +
        "a query path cannot end in one",
    };
  }
  return {
    relationTypeKey,
    direction,
    propertySource,
    propertyKey,
    propertyDef,
  };
}
