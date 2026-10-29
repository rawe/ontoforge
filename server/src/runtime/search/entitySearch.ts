/**
 * The entity search (`POST search/entities`): one query text over a scope
 * of search indices, by the methods its blocks choose, restricted by exact
 * filters. It compiles into a search tree (`compileEntitySearch`) that the
 * executor runs; nothing here ranks.
 *
 * 1. Scope: neither `types` nor `indices` — every type the lens shows,
 *    through its managed indices the lens can search; `types` — the
 *    managed indices of these; `indices` — exactly these, custom ones
 *    included. A named type without a managed index to search is a
 *    limitation, not an error.
 * 2. Methods: the blocks sent; neither — both with an embedding provider,
 *    so semantic runs wherever it can and keyword alone answers where it
 *    cannot; keyword only without one. A `semantic` block without an
 *    embedding provider is a disabled feature.
 * 3. Filters: the `filter.*` keys of the entity list, without the prefix
 *    (`resolveSearchFilters`). A type that does not declare every key
 *    drops out; the rest are restricted by push-down, one filter per type.
 * 4. Each found entity is named, with the best entry that found it.
 *    An entity gone since the ranking is left out.
 *
 * What could not run — a method on some indices, a type without an index,
 * a filter no type declares — is reported as a limitation; every rule the
 * request breaks is collected, by the request's own path.
 */

import { ValidationError } from "../../core/exceptions.js";
import type { KeywordMatching, Row, RuntimeStore, SearchIndexRecord } from "../../core/ports.js";
import { compileEntitySearch } from "../../core/searchCompile.js";
import { documentField } from "../../core/searchComposition.js";
import type { SearchRepresentation } from "../../core/searchIndex.js";
import type { MethodBlocks } from "../../core/searchTree.js";
import { loadSchema, type LoadedSchema } from "../schemaCache.js";
import { deploymentMethods } from "./availability.js";
import type { Limitation } from "./executor.js";
import {
  describeMatches,
  indexStoreOf,
  readHitEntities,
  runSearchTree,
  searchableIndices,
  type EngineHit,
} from "./indexSearch.js";
import { resolveSearchFilters } from "./request.js";

export interface EntitySearchRequest {
  query: string;
  /** Entity type keys; absent: every type the lens shows. Not with
   * `indices`. */
  types?: string[];
  /** Index keys, custom ones included. Not with `types`. */
  indices?: string[];
  keyword?: { match?: string };
  semantic?: { minSimilarity?: number };
  /** Exact conditions, as the entity list's `filter.*` keys. */
  filter?: Record<string, string>;
  /** Entities, 1..100; default 10. */
  limit?: number;
}

/** An entity as an entity search names it. */
export interface EntityReference {
  _id: string;
  _entityTypeKey: string;
  /** Its name property's value; null when it has none, or the lens hides it. */
  name: string | null;
}

/** The best entry that found an entity. `snippet` is null when the index
 * reads a property the lens hides. */
export type EntityMatch =
  | { index: string; part: "self"; snippet: string | null }
  | { index: string; part: "relation"; snippet: string | null; relationType: string; target: EntityReference }
  | {
      index: string;
      part: "passage";
      snippet: string | null;
      /** The document; null when the lens hides it. */
      property: string | null;
      charOffset: number;
      charLength: number;
    };

export interface EntitySearchItem {
  /** From 1. */
  rank: number;
  entity: EntityReference;
  match: EntityMatch;
}

export interface EntitySearchLimitation {
  code: Exclude<Limitation["code"], "no-provider"> | "not-searchable" | "filter-excludes-all-types";
  message: string;
  method?: SearchRepresentation;
  indices?: string[];
  types?: string[];
}

export interface EntitySearchResponse {
  /** The methods that ran on at least one index, semantic first. */
  ran: SearchRepresentation[];
  items: EntitySearchItem[];
  limitations: EntitySearchLimitation[];
}

const MATCHES: readonly KeywordMatching[] = ["any", "all"];

/** Rank entities for a query text (module comment). */
export async function searchEntities(
  lensKey: string,
  request: EntitySearchRequest,
  store: RuntimeStore,
): Promise<EntitySearchResponse> {
  const indexStore = indexStoreOf(store);
  const loaded = await loadSchema(lensKey, store);
  const errors: Record<string, string> = {};

  if (!request.query?.trim()) errors.query = "Required non-empty query";
  const limit = request.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) errors.limit = "Expected integer from 1 to 100";
  const match = request.keyword?.match ?? "any";
  if (!(MATCHES as readonly string[]).includes(match)) errors["keyword.match"] = "Expected any or all";
  const minSimilarity = request.semantic?.minSimilarity;
  if (minSimilarity !== undefined && !(minSimilarity >= 0 && minSimilarity <= 1)) {
    errors["semantic.minSimilarity"] = "Expected number from 0 to 1";
  }

  const limitations: EntitySearchLimitation[] = [];
  const searchable = await searchableIndices(loaded, indexStore);
  const { selected, scopeTypes } = scopeOf(loaded, request, searchable, errors, limitations);

  const filterErrors: Record<string, string> = {};
  const eligible = resolveSearchFilters(
    request.filter ?? {},
    scopeTypes.map((key) => [key, loaded.scoped.entityTypes[key]!]),
    false,
    loaded,
    store,
    filterErrors,
  );
  for (const [key, message] of Object.entries(filterErrors)) errors[`filter.${key}`] = message;

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(Object.values(errors).join("; "), { fields: errors });
  }
  const semantic = deploymentMethods(store).includes("semantic");
  if (request.semantic !== undefined && !semantic) {
    throw new ValidationError("Semantic search unavailable: no embedding provider is installed", {
      code: "FEATURE_DISABLED",
    });
  }

  const conditions = new Map(eligible.map((type) => [type.entityTypeKey, type.conditions] as const));
  const targets = selected.filter((index) => conditions.has(index.definition.entityType));
  if (selected.length > 0 && targets.length === 0) {
    limitations.push({
      code: "filter-excludes-all-types",
      message: "No searched entity type declares every filter key",
      types: [...new Set(selected.map((index) => index.definition.entityType))],
    });
  }
  if (targets.length === 0) return { ran: [], items: [], limitations };

  // Neither block: what can run — with a provider both, so a method that
  // cannot run on an index leaves the other.
  const methods: MethodBlocks =
    request.keyword === undefined && request.semantic === undefined
      ? { ...(semantic ? { semantic: {} } : {}), keyword: { match: "any" } }
      : {
          ...(request.semantic === undefined
            ? {}
            : { semantic: minSimilarity === undefined ? {} : { minSimilarity } }),
          ...(request.keyword === undefined ? {} : { keyword: { match: match as KeywordMatching } }),
        };
  const tree = compileEntitySearch({
    text: request.query,
    targets: targets.map((index) => ({
      index: index.key,
      entityType: index.definition.entityType,
      conditions: conditions.get(index.definition.entityType)!,
      entityIds: null,
      relations: null,
    })),
    methods,
    relations: null,
    limit,
  });
  const result = await runSearchTree(loaded, indexStore, targets, tree);
  for (const limitation of result.limitations) limitations.push(described(limitation));

  // A method ran unless every one of its search nodes could not.
  const ran = (["semantic", "keyword"] as const).filter(
    (method) =>
      methods[method] !== undefined &&
      result.limitations.filter((l) => l.method === method).flatMap((l) => l.indices).length < targets.length,
  );
  // One search: its hit is the entity's.
  const hits = result.hits.map((hit) => hit.provenance[0]!.hit!);
  const entities = await readHitEntities(loaded, store, hits, null);
  const present = hits.filter((hit) => entities.has(hit.entityId));
  return { ran, items: await itemsOf(loaded, store, present, entities), limitations };
}

/** The indices the request's scope selects, in key order, and the types
 * its filters are checked against. A scope field the lens cannot serve is
 * an error at its path; a named type without a managed index to search a
 * limitation. */
function scopeOf(
  loaded: LoadedSchema,
  request: EntitySearchRequest,
  searchable: SearchIndexRecord[],
  errors: Record<string, string>,
  limitations: EntitySearchLimitation[],
): { selected: SearchIndexRecord[]; scopeTypes: string[] } {
  const managed = searchable.filter((index) => index.kind !== "custom");
  const { types, indices } = request;
  if (types !== undefined && indices !== undefined) errors.indices = "Name types or indices, not both";

  if (indices !== undefined) {
    if (indices.length === 0) errors.indices ??= "Name at least one index, or omit indices";
    // An unknown key answers as one the lens cannot search: the lens does
    // not tell which indices exist beyond it.
    indices.forEach((key, i) => {
      if (!searchable.some((index) => index.key === key)) {
        errors[`indices.${i}`] = `Search index '${key}' is not available in this lens`;
      }
    });
    const selected = searchable.filter((index) => indices.includes(index.key));
    return { selected, scopeTypes: [...new Set(selected.map((index) => index.definition.entityType))] };
  }

  if (types !== undefined) {
    if (types.length === 0) errors.types = "Name at least one entity type, or omit types";
    types.forEach((key, i) => {
      if (loaded.scoped.entityTypes[key] === undefined) errors[`types.${i}`] = `Entity type '${key}' not found`;
    });
    const named = [...new Set(types)].filter((key) => loaded.scoped.entityTypes[key] !== undefined);
    const selected = managed.filter((index) => named.includes(index.definition.entityType));
    const unsearchable = named.filter((key) => !selected.some((index) => index.definition.entityType === key));
    if (unsearchable.length > 0) {
      limitations.push({
        code: "not-searchable",
        message: "These entity types have no search index this lens can search",
        types: unsearchable,
      });
    }
    return { selected, scopeTypes: named };
  }

  return { selected: managed, scopeTypes: Object.keys(loaded.scoped.entityTypes) };
}

const METHOD_NAMES: Record<SearchRepresentation, string> = { semantic: "Semantic", keyword: "Keyword" };

/** A search node limitation of the tree, as the response tells it. */
function described({ code, method, indices }: Limitation): EntitySearchLimitation {
  if (code === "no-provider") throw new Error("Semantic search nodes are compiled only with an embedding provider");
  const messages: Record<typeof code, string> = {
    "switched-off": `${METHOD_NAMES[method]} search is switched off on these indices`,
    "not-ready": `${METHOD_NAMES[method]} search entries of these indices are not built yet`,
  };
  return { code, message: messages[code], method, indices };
}

/** The hits as items: each entity named, with its best entry. */
async function itemsOf(
  loaded: LoadedSchema,
  store: RuntimeStore,
  hits: EngineHit[],
  entities: Map<string, Row>,
): Promise<EntitySearchItem[]> {
  const matched = await describeMatches(loaded, store, hits);
  return hits.map((hit, i): EntitySearchItem => {
    const entity = entities.get(hit.entityId)!;
    const nameProperty = loaded.scoped.entityTypes[hit.entityType]?.nameProperty ?? null;
    const name = nameProperty === null ? null : entity[nameProperty];
    const { index, partKind, relationType, target, snippet, charOffset, charLength } = matched.get(hit.entityId)!;
    // `describeMatches` withholds a hidden property's text as "".
    const shown = snippet === "" ? null : snippet;
    let match: EntityMatch;
    if (partKind === "relation") {
      match = {
        index,
        part: "relation",
        snippet: shown,
        relationType: relationType!,
        target: { _id: target!.id, _entityTypeKey: target!.type, name: target!.label },
      };
    } else if (partKind === "passage") {
      const property = documentField(hit.matched.index.definition, loaded.full);
      const root = loaded.scoped.entityTypes[hit.entityType]!;
      match = {
        index,
        part: "passage",
        snippet: shown,
        property: property !== null && property in root.properties ? property : null,
        charOffset: charOffset!,
        charLength: charLength!,
      };
    } else {
      match = { index, part: "self", snippet: shown };
    }
    return {
      rank: i + 1,
      entity: {
        _id: hit.entityId,
        _entityTypeKey: hit.entityType,
        name: typeof name === "string" && name !== "" ? name : null,
      },
      match,
    };
  });
}
