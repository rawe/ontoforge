/**
 * What the entity search (`entitySearch.ts`) and the passage search
 * (`passageSearch.ts`) share: one query text over a scope of search
 * indices, by the methods its blocks choose, restricted by exact filters.
 *
 * - The request's bounds and method options, each broken rule at the
 *   request's own path.
 * - A scope named by `types` or by `indices`; a named type without an
 *   index to search is a limitation, not an error.
 * - Filters: the `filter.*` keys of the entity list, without the prefix
 *   (`resolveSearchFilters`), checked against the scope's types. A type
 *   that does not declare every key — or that a query path does not
 *   resolve from — drops out; the rest are restricted by push-down, one
 *   filter per type. A key no type of the scope resolves is an error.
 * - Methods: the blocks sent; neither — both with an embedding provider,
 *   so semantic runs wherever it can and keyword alone answers where it
 *   cannot; keyword only without one. A `semantic` block without an
 *   embedding provider is a disabled feature.
 * - The run: what could not run as limitations, and the methods that ran.
 */

import { ValidationError } from "../../core/exceptions.js";
import type { FilterCondition, KeywordMatching, Row, RuntimeStore, SearchIndexRecord } from "../../core/ports.js";
import { documentField } from "../../core/searchComposition.js";
import type { SearchRepresentation } from "../../core/searchIndex.js";
import type { MethodBlocks, TreeNode } from "../../core/searchTree.js";
import type { LoadedSchema } from "../schemaCache.js";
import { deploymentMethods } from "./availability.js";
import type { Limitation, TreeHit } from "./executor.js";
import { indexStoreOf, runSearchTree } from "./indexSearch.js";
import { resolveSearchFilters } from "./request.js";

/** The request fields both searches share. */
export interface ScopedSearchRequest {
  query: string;
  keyword?: { match?: string };
  semantic?: { minSimilarity?: number };
  /** Exact conditions, as the entity list's `filter.*` keys. */
  filter?: Record<string, string>;
  /** Items, 1..100; default 10. */
  limit?: number;
}

/** What could not run, or what a named scope could not serve. */
export interface SearchLimitation {
  code: Exclude<Limitation["code"], "no-provider"> | "not-searchable" | "filter-excludes-all-types";
  message: string;
  method?: SearchRepresentation;
  indices?: string[];
  types?: string[];
  /** Named document properties, as `type.property`. */
  documents?: string[];
}

/** An entity as a search names it. */
export interface EntityReference {
  _id: string;
  _entityTypeKey: string;
  /** Its name property's value; null when it has none, or the lens hides it. */
  name: string | null;
  /** Its identity properties and their values, in the identity's order;
   * absent when its type declares none the lens shows. */
  identity?: Row;
}

/** An index to rank, with the exact conditions on its root type. */
export interface FilteredTarget {
  index: SearchIndexRecord;
  conditions: FilterCondition[];
}

const MATCHES: readonly KeywordMatching[] = ["any", "all"];

/** The limit; the query, the limit and the method options checked into
 * `errors`, by path. */
export function checkRequest(request: ScopedSearchRequest, errors: Record<string, string>): number {
  if (!request.query?.trim()) errors.query = "Required non-empty query";
  const limit = request.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) errors.limit = "Expected integer from 1 to 100";
  const match = request.keyword?.match ?? "any";
  if (!(MATCHES as readonly string[]).includes(match)) errors["keyword.match"] = "Expected any or all";
  const minSimilarity = request.semantic?.minSimilarity;
  if (minSimilarity !== undefined && !(minSimilarity >= 0 && minSimilarity <= 1)) {
    errors["semantic.minSimilarity"] = "Expected number from 0 to 1";
  }
  return limit;
}

/** `indices`: exactly the named indices the lens can search, in key order;
 * one it cannot, or that does not exist, is an error at its position. */
export function namedIndices(
  keys: string[],
  searchable: SearchIndexRecord[],
  errors: Record<string, string>,
): SearchIndexRecord[] {
  if (keys.length === 0) errors.indices ??= "Name at least one index, or omit indices";
  // An unknown key answers as one the lens cannot search: the lens does
  // not tell which indices exist beyond it.
  keys.forEach((key, i) => {
    if (!searchable.some((index) => index.key === key)) {
      errors[`indices.${i}`] = `Search index '${key}' is not available in this lens`;
    }
  });
  return searchable.filter((index) => keys.includes(index.key));
}

/** `types`: the indices of `managed` whose root is a named type, and the
 * named types the lens shows. An unknown or hidden type is an error at its
 * position; a named type without such an index a limitation. */
export function namedTypes(
  loaded: LoadedSchema,
  keys: string[],
  managed: SearchIndexRecord[],
  errors: Record<string, string>,
  limitations: SearchLimitation[],
  unsearchableMessage: string,
): { selected: SearchIndexRecord[]; scopeTypes: string[] } {
  if (keys.length === 0) errors.types = "Name at least one entity type, or omit types";
  keys.forEach((key, i) => {
    if (loaded.scoped.entityTypes[key] === undefined) errors[`types.${i}`] = `Entity type '${key}' not found`;
  });
  const named = [...new Set(keys)].filter((key) => loaded.scoped.entityTypes[key] !== undefined);
  const selected = managed.filter((index) => named.includes(index.definition.entityType));
  const unsearchable = named.filter((key) => !selected.some((index) => index.definition.entityType === key));
  if (unsearchable.length > 0) {
    limitations.push({ code: "not-searchable", message: unsearchableMessage, types: unsearchable });
  }
  return { selected, scopeTypes: named };
}

/** The root types of indices, once each. */
export function rootTypes(indices: SearchIndexRecord[]): string[] {
  return [...new Set(indices.map((index) => index.definition.entityType))];
}

/** The document an index reads passages of, when the lens shows it. */
export function shownDocument(loaded: LoadedSchema, index: SearchIndexRecord): string | null {
  const property = documentField(index.definition, loaded.full);
  const root = loaded.scoped.entityTypes[index.definition.entityType];
  return property !== null && root !== undefined && property in root.properties ? property : null;
}

/**
 * The selected indices whose root type declares every filter key — a
 * query path: resolves from it — each with its type's conditions; a filter
 * key no type of the scope resolves is an error at `filter.<key>`. Every error collected so far is thrown
 * here, then a `semantic` block without an embedding provider. No type
 * left is a limitation.
 */
export function filteredTargets(
  loaded: LoadedSchema,
  store: RuntimeStore,
  request: ScopedSearchRequest,
  selected: SearchIndexRecord[],
  scopeTypes: string[],
  errors: Record<string, string>,
  limitations: SearchLimitation[],
): FilteredTarget[] {
  const filterErrors: Record<string, string> = {};
  const eligible = resolveSearchFilters(
    request.filter ?? {},
    scopeTypes.map((key) => [key, loaded.scoped.entityTypes[key]!]),
    false,
    loaded,
    store,
    filterErrors,
    { pathsDropOut: true },
  );
  for (const [key, message] of Object.entries(filterErrors)) errors[`filter.${key}`] = message;

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(Object.values(errors).join("; "), { fields: errors });
  }
  if (request.semantic !== undefined && !deploymentMethods(store).includes("semantic")) {
    throw new ValidationError("Semantic search unavailable: no embedding provider is installed", {
      code: "FEATURE_DISABLED",
    });
  }

  const conditions = new Map(eligible.map((type) => [type.entityTypeKey, type.conditions] as const));
  const targets = selected
    .filter((index) => conditions.has(index.definition.entityType))
    .map((index) => ({ index, conditions: conditions.get(index.definition.entityType)! }));
  if (selected.length > 0 && targets.length === 0) {
    limitations.push({
      code: "filter-excludes-all-types",
      message: "No searched entity type declares every filter key",
      types: rootTypes(selected),
    });
  }
  return targets;
}

/** The method blocks of a checked request (module comment). */
export function methodsOf(request: ScopedSearchRequest, store: RuntimeStore): MethodBlocks {
  // Neither block: what can run — with a provider both, so a method that
  // cannot run on an index leaves the other.
  if (request.keyword === undefined && request.semantic === undefined) {
    return { ...(deploymentMethods(store).includes("semantic") ? { semantic: {} } : {}), keyword: { match: "any" } };
  }
  const minSimilarity = request.semantic?.minSimilarity;
  return {
    ...(request.semantic === undefined ? {} : { semantic: minSimilarity === undefined ? {} : { minSimilarity } }),
    ...(request.keyword === undefined
      ? {}
      : { keyword: { match: (request.keyword.match ?? "any") as KeywordMatching } }),
  };
}

/** Run a search's tree over its targets: what could not run added to
 * `limitations`, and the methods that ran on at least one index, semantic
 * first. */
export async function runScopedSearch(
  loaded: LoadedSchema,
  store: RuntimeStore,
  targets: FilteredTarget[],
  methods: MethodBlocks,
  tree: TreeNode,
  limitations: SearchLimitation[],
): Promise<{ hits: TreeHit[]; ran: SearchRepresentation[] }> {
  const indices = targets.map((target) => target.index);
  const result = await runSearchTree(loaded, indexStoreOf(store), indices, tree);
  for (const limitation of result.limitations) limitations.push(described(limitation));
  // A method ran unless every one of its search nodes could not.
  const ran = (["semantic", "keyword"] as const).filter(
    (method) =>
      methods[method] !== undefined &&
      result.limitations.filter((l) => l.method === method).flatMap((l) => l.indices).length < indices.length,
  );
  return { hits: result.hits, ran };
}

const METHOD_NAMES: Record<SearchRepresentation, string> = { semantic: "Semantic", keyword: "Keyword" };

/** A search node limitation of the tree, as the response tells it. */
function described({ code, method, indices }: Limitation): SearchLimitation {
  if (code === "no-provider") throw new Error("Semantic search nodes are compiled only with an embedding provider");
  const messages: Record<typeof code, string> = {
    "switched-off": `${METHOD_NAMES[method]} search is switched off on these indices`,
    "not-ready": `${METHOD_NAMES[method]} search entries of these indices are not built yet`,
  };
  return { code, message: messages[code], method, indices };
}

/** The properties that name a hit's entity: its name property and its
 * identity properties, as far as the lens shows them. */
export function namingProperties(loaded: LoadedSchema, entityType: string): string[] {
  const type = loaded.scoped.entityTypes[entityType];
  if (type === undefined) return [];
  return [...(type.nameProperty === null ? [] : [type.nameProperty]), ...(type.identityProperties ?? [])];
}

/** The entity of a hit, named through the lens: its name and — when its
 * type declares an identity the lens shows — its identity properties. */
export function entityReference(
  loaded: LoadedSchema,
  hit: { entityId: string; entityType: string },
  entity: Row,
): EntityReference {
  const type = loaded.scoped.entityTypes[hit.entityType];
  const nameProperty = type?.nameProperty ?? null;
  const name = nameProperty === null ? null : entity[nameProperty];
  const identity = type?.identityProperties ?? null;
  return {
    _id: hit.entityId,
    _entityTypeKey: hit.entityType,
    name: typeof name === "string" && name !== "" ? name : null,
    ...(identity === null ? {} : { identity: Object.fromEntries(identity.map((key) => [key, entity[key]])) }),
  };
}
