import { ValidationError } from "../../core/exceptions.js";
import type { RuntimeStore, SearchedType } from "../../core/ports.js";
import { parseFilterConditions } from "../readHelpers.js";
import { isQueryPath, resolveQueryPath } from "../queryPaths.js";
import type { EntityTypeDef, LoadedSchema } from "../schemaCache.js";
/**
 * Search filter resolution: the filters of a search, checked against the
 * types of its scope.
 */

/**
 * Validate search filters against the types they may apply to and narrow
 * those types: each key is checked against the types declaring it, and
 * the type set is the intersection over all keys. A type a query path
 * does not resolve from cannot satisfy it and drops out, unless no type
 * resolves it. Failures are collected into `errors`. Returns the
 * remaining types, each with its parsed conditions.
 */
export function resolveSearchFilters(
  filter: Record<string, string>,
  types: [string, EntityTypeDef][],
  loaded: Pick<LoadedSchema, "scoped">,
  store: Pick<RuntimeStore, "supportsSearchPathConditions">,
  errors: Record<string, string>,
): SearchedType[] {
  const eligible = new Map(
    types.map(([key, def]) => [
      key,
      { entityTypeKey: key, propertyDefs: def.properties, conditions: [] } as SearchedType,
    ]),
  );
  // Validate every key against its declaring types, then intersect their sets.
  // Validate before intersecting so contradictory filter keys cannot hide faults.
  for (const [expr, value] of Object.entries(filter)) {
    const split = expr.lastIndexOf("__");
    const key = split < 0 ? expr : expr.slice(0, split);
    const op = split < 0 ? null : expr.slice(split + 2);
    // An existence key may name a bare relation type; it carries no data
    // type, so its declaring types cannot conflict.
    const existence = op === "exists" || op === "missing";
    const touches = (tk: string): boolean => {
      const rt = loaded.scoped.relationTypes[key.split(/[.@]/)[0]!.replace(/:(in|out)$/, "")];
      return rt !== undefined && (rt.fromEntityTypeKey === tk || rt.toEntityTypeKey === tk);
    };
    let declaring = types.filter(([tk, def]) => {
      if (!isQueryPath(key) && key in def.properties) return true;
      return (isQueryPath(key) || existence) && touches(tk);
    });
    if (isQueryPath(key)) {
      const use = existence ? "existence" : "comparison";
      const resolving = declaring.filter(([tk]) => !("message" in resolveQueryPath(key, tk, loaded.scoped, use)));
      // None resolves it: every type's fault is reported.
      if (resolving.length > 0) declaring = resolving;
    }
    if (!declaring.length) errors[expr] = `Unknown filter property or relation type: '${key}'`;
    const dataTypes = new Set<string>();
    for (const [tk, def] of declaring) {
      if (existence) {
        // no data type
      } else if (isQueryPath(key)) {
        const path = resolveQueryPath(key, tk, loaded.scoped, "comparison");
        if ("propertyDef" in path) dataTypes.add(path.propertyDef.dataType);
      } else if (def.properties[key]) dataTypes.add(def.properties[key]!.dataType);
      try {
        const conditions = parseFilterConditions({ [expr]: value }, def.properties, tk, {
          rejectContains: {
            message: "Substring filters are not supported on search; use the entity list",
            detail: "Not supported on search; use the entity list",
          },
          pathSchema: loaded.scoped,
          ...(store.supportsSearchPathConditions()
            ? {}
            : {
                rejectRelationConditions: () => ({
                  message:
                    "Query paths and relation filters are not supported on search by the active storage adapter; use the entity list",
                  detail:
                    "Not supported on search by the active storage adapter; use the entity list",
                }),
              }),
        });
        eligible.get(tk)?.conditions.push(...conditions);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        Object.assign(errors, error.details?.fields ?? { [expr]: error.message });
      }
    }
    if (dataTypes.size > 1)
      errors[expr] = `Conflicting data types for '${key}': ${[...dataTypes].join(", ")}`;
    const keys = new Set(declaring.map(([tk]) => tk));
    for (const tk of eligible.keys()) if (!keys.has(tk)) eligible.delete(tk);
  }
  return [...eligible.values()];
}
