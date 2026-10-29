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
 *    (`resolveSearchFilters`). A type that does not declare every key, or
 *    that a query path does not resolve from, drops out; the rest are
 *    restricted by push-down, one filter per type.
 * 4. Each found entity is named — with its identity properties when its
 *    type declares an identity the lens shows — with the best entry that
 *    found it. An entity gone since the ranking is left out.
 *
 * What could not run — a method on some indices, a type without an index,
 * a filter no type declares — is reported as a limitation; every rule the
 * request breaks is collected, by the request's own path.
 */

import type { Row, RuntimeStore, SearchIndexRecord } from "../../core/ports.js";
import { compileEntitySearch } from "../../core/searchCompile.js";
import type { SearchRepresentation } from "../../core/searchIndex.js";
import { loadSchema, type LoadedSchema } from "../schemaCache.js";
import { describeMatches, indexStoreOf, readHitEntities, searchableIndices, type EngineHit } from "./indexSearch.js";
import {
  checkRequest,
  entityReference,
  filteredTargets,
  methodsOf,
  namedIndices,
  namedTypes,
  rootTypes,
  runScopedSearch,
  shownDocument,
  type EntityReference,
  type ScopedSearchRequest,
  type SearchLimitation,
} from "./scopedSearch.js";

export interface EntitySearchRequest extends ScopedSearchRequest {
  /** Entity type keys; absent: every type the lens shows. Not with
   * `indices`. */
  types?: string[];
  /** Index keys, custom ones included. Not with `types`. */
  indices?: string[];
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

export interface EntitySearchResponse {
  /** The methods that ran on at least one index, semantic first. */
  ran: SearchRepresentation[];
  items: EntitySearchItem[];
  limitations: SearchLimitation[];
}

/** Rank entities for a query text (module comment). */
export async function searchEntities(
  lensKey: string,
  request: EntitySearchRequest,
  store: RuntimeStore,
): Promise<EntitySearchResponse> {
  const loaded = await loadSchema(lensKey, store);
  const errors: Record<string, string> = {};
  const limit = checkRequest(request, errors);

  const limitations: SearchLimitation[] = [];
  const searchable = await searchableIndices(loaded, indexStoreOf(store));
  const { selected, scopeTypes } = scopeOf(loaded, request, searchable, errors, limitations);
  const targets = filteredTargets(loaded, store, request, selected, scopeTypes, errors, limitations);
  if (targets.length === 0) return { ran: [], items: [], limitations };

  const methods = methodsOf(request, store);
  const tree = compileEntitySearch({
    text: request.query,
    targets: targets.map(({ index, conditions }) => ({
      index: index.key,
      entityType: index.definition.entityType,
      conditions,
      entityIds: null,
      relations: null,
    })),
    methods,
    relations: null,
    limit,
  });
  const result = await runScopedSearch(loaded, store, targets, methods, tree, limitations);
  // One search: its hit is the entity's.
  const hits = result.hits.map((hit) => hit.provenance[0]!.hit!);
  const entities = await readHitEntities(loaded, store, hits, null);
  const present = hits.filter((hit) => entities.has(hit.entityId));
  return { ran: result.ran, items: await itemsOf(loaded, store, present, entities), limitations };
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
  limitations: SearchLimitation[],
): { selected: SearchIndexRecord[]; scopeTypes: string[] } {
  const managed = searchable.filter((index) => index.kind !== "custom");
  const { types, indices } = request;
  if (types !== undefined && indices !== undefined) errors.indices = "Name types or indices, not both";
  if (indices !== undefined) {
    const selected = namedIndices(indices, searchable, errors);
    return { selected, scopeTypes: rootTypes(selected) };
  }
  if (types !== undefined) {
    const message = "These entity types have no search index this lens can search";
    return namedTypes(loaded, types, managed, errors, limitations, message);
  }
  return { selected: managed, scopeTypes: Object.keys(loaded.scoped.entityTypes) };
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
      match = {
        index,
        part: "passage",
        snippet: shown,
        property: shownDocument(loaded, hit.matched.index),
        charOffset: charOffset!,
        charLength: charLength!,
      };
    } else {
      match = { index, part: "self", snippet: shown };
    }
    return { rank: i + 1, entity: entityReference(loaded, hit, entities.get(hit.entityId)!), match };
  });
}
