import { ValidationError } from "../../core/exceptions.js";
import type { RuntimeStore, SearchedType, SearchedProperty } from "../../core/ports.js";
import { parseFilterConditions } from "../readHelpers.js";
import { isQueryPath, resolveQueryPath } from "../queryPaths.js";
import { loadSchema } from "../schemaCache.js";
import { SEARCH_STRATEGIES, type SearchStrategy } from "./strategies.js";
export type SearchKind = "properties" | "document";
export interface SearchRequest {
  query: string;
  type?: string | null;
  in?: SearchKind[] | null;
  strategy?: SearchStrategy | null;
  limit?: number;
  filter?: Record<string, string>;
  fields?: string[] | null;
  document?: { property?: string };
}
export async function validateRequest(
  lensKey: string,
  request: SearchRequest,
  store: RuntimeStore,
) {
  const loaded = await loadSchema(lensKey, store);
  const errors: Record<string, string> = {};
  const kinds =
    request.in == null ? (["properties", "document"] as SearchKind[]) : [...new Set(request.in)];
  if (!request.query?.trim()) errors.q = "Required non-empty query";
  if (!kinds.length || kinds.some((k) => !["properties", "document"].includes(k)))
    errors.in = "Expected properties or document";
  if (
    request.strategy != null &&
    !(SEARCH_STRATEGIES as readonly string[]).includes(request.strategy)
  )
    errors.strategy = "Unknown search strategy";
  const limit = request.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    errors.limit = "Expected integer from 1 to 100";
  const type = request.type ?? null;
  if (type !== null && !loaded.scoped.entityTypes[type])
    errors.type = `Entity type '${type}' not found`;
  const types = Object.entries(loaded.scoped.entityTypes).filter(
    ([key]) => type === null || key === type,
  );
  const filter = request.filter ?? {};
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
    const declaring =
      type !== null
        ? types
        : types.filter(([tk, def]) => {
            if (!isQueryPath(key) && key in def.properties) return true;
            return (isQueryPath(key) || existence) && touches(tk);
          });
    if (!declaring.length) errors[expr] = `Unknown filter property or relation type: '${key}'`;
    const dataTypes = new Set<string>();
    for (const [tk, def] of declaring) {
      if (existence) {
        // no data type
      } else if (isQueryPath(key)) {
        const path = resolveQueryPath(key, tk, loaded.scoped);
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
  const searchedTypes = [...eligible.values()];
  const property = request.document?.property;
  if (
    property !== undefined &&
    (!kinds.includes("document") || typeof property !== "string" || !property)
  )
    errors["document.property"] = "Requires document search and one document property key";
  const searchedProperties: SearchedProperty[] = searchedTypes.flatMap((t) =>
    Object.entries(t.propertyDefs)
      .filter(
        ([key, def]) => def.dataType === "document" && (property === undefined || property === key),
      )
      .map(([propertyKey]) => ({
        entityTypeKey: t.entityTypeKey,
        propertyKey,
        conditions: t.conditions,
      })),
  );
  if (property !== undefined && !searchedProperties.length)
    errors["document.property"] =
      "No exposed document property with this key in the searched types";
  if (request.in != null && kinds.includes("document") && !searchedProperties.length)
    errors.in = "No document properties to search";
  if (request.in != null && kinds.includes("properties") && !types.length)
    errors.in = "No entity types to search";
  if (Object.keys(errors).length)
    throw new ValidationError(Object.values(errors).join("; "), { fields: errors });
  return { loaded, kinds, type, limit, filter, searchedTypes, searchedProperties };
}
