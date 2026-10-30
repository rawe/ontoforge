/**
 * The passage search (`POST search/passages`): one query text over a scope
 * of search indices that read a document, ranking passages — not
 * entities. It compiles into a search tree (`compilePassageSearch`) that
 * the executor runs; nothing here ranks. Bounds, method blocks, filters
 * and limitations are the entity search's (`scopedSearch.ts`).
 *
 * 1. Scope: only indices that read a document the lens shows. None of
 *    `types`, `documents`, `indices` — every type the lens shows, through
 *    its managed passage indices; `types` — the managed passage indices of
 *    these; `documents` (`type.property`) — the managed passage index of
 *    each; `indices` — exactly these, custom ones included. A named type
 *    or document without a managed passage index to search is a
 *    limitation, not an error.
 * 2. Only passage entries count. A passage is one chunk of one document of
 *    one entity: two indices over one document find the same passages, and
 *    each counts once, by its best entry. `perEntity` keeps at most that
 *    many per entity, in rank order.
 * 3. Filters apply to the entity that owns the document.
 * 4. Each passage is named with its entity, its document and its place in
 *    it, and — unless `text` is false — its text, read from the entity's
 *    current document at that place. An entity gone since the ranking is
 *    left out.
 */

import type { RuntimeStore, SearchIndexRecord } from "../../core/ports.js";
import { compilePassageSearch } from "../../core/searchCompile.js";
import type { SearchRepresentation } from "../../core/searchIndex.js";
import { loadSchema, type LoadedSchema } from "../schemaCache.js";
import { documentSlice } from "../service.js";
import { indexStoreOf, readHitEntities, searchableIndices } from "./indexSearch.js";
import {
  checkRequest,
  entityReference,
  filteredTargets,
  methodsOf,
  namedIndices,
  namedTypes,
  namingProperties,
  rootTypes,
  runScopedSearch,
  shownDocument,
  type EntityReference,
  type ScopedSearchRequest,
  type SearchLimitation,
} from "./scopedSearch.js";

export interface PassageSearchRequest extends ScopedSearchRequest {
  /** Entity type keys; absent: every type the lens shows. One scope field
   * at a time. */
  types?: string[];
  /** Document properties, as `type.property`. */
  documents?: string[];
  /** Index keys, custom ones included. */
  indices?: string[];
  /** Passages per entity, 1..limit; absent: no cap. */
  perEntity?: number;
  /** Whether items carry the passage's text; default true. */
  text?: boolean;
}

/** A passage: its document, its chunk ordinal and its place in the
 * document, in code points. */
export interface PassageReference {
  property: string;
  ordinal: number;
  charOffset: number;
  charLength: number;
  /** The document's current text at that place; absent when the request
   * leaves it out. */
  text?: string;
}

export interface PassageSearchItem {
  /** From 1. */
  rank: number;
  entity: EntityReference;
  passage: PassageReference;
}

export interface PassageSearchResponse {
  /** The methods that ran on at least one index, semantic first. */
  ran: SearchRepresentation[];
  items: PassageSearchItem[];
  limitations: SearchLimitation[];
}

const SCOPE_FIELDS = ["types", "documents", "indices"] as const;

/** Rank passages for a query text (module comment). */
export async function searchPassages(
  lensKey: string,
  request: PassageSearchRequest,
  store: RuntimeStore,
): Promise<PassageSearchResponse> {
  const loaded = await loadSchema(lensKey, store);
  const errors: Record<string, string> = {};
  const limit = checkRequest(request, errors);
  const perEntity = request.perEntity ?? null;
  if (perEntity !== null && !(Number.isInteger(perEntity) && perEntity >= 1 && perEntity <= limit)) {
    errors.perEntity = "Expected integer from 1 to limit";
  }

  const limitations: SearchLimitation[] = [];
  const searchable = await searchableIndices(loaded, indexStoreOf(store));
  const { selected, scopeTypes } = scopeOf(loaded, request, searchable, errors, limitations);
  const targets = filteredTargets(loaded, store, request, selected, scopeTypes, errors, limitations);
  if (targets.length === 0) return { ran: [], items: [], limitations };

  const methods = methodsOf(request, store);
  const tree = compilePassageSearch({
    text: request.query,
    targets: targets.map(({ index, conditions }) => ({
      index: index.key,
      entityType: index.definition.entityType,
      conditions,
    })),
    methods,
    limit,
    perEntity,
  });
  const result = await runScopedSearch(loaded, store, targets, methods, tree, limitations);
  // One search: its hit is the passage's.
  const hits = result.hits.map((hit) => hit.provenance[0]!.hit!);
  const withText = request.text ?? true;
  const fields = new Set<string>();
  for (const hit of hits) {
    for (const property of namingProperties(loaded, hit.entityType)) fields.add(property);
    if (withText) fields.add(shownDocument(loaded, hit.matched.index)!);
  }
  const entities = await readHitEntities(loaded, store, hits, [...fields]);
  const items = hits
    .filter((hit) => entities.has(hit.entityId))
    .map((hit, i): PassageSearchItem => {
      const entity = entities.get(hit.entityId)!;
      const { entry } = hit.matched;
      const property = shownDocument(loaded, hit.matched.index)!;
      const passage: PassageReference = {
        property,
        ordinal: Number(entry.partId),
        charOffset: entry.startChar!,
        charLength: entry.charLength!,
      };
      if (withText) {
        const value = entity[property];
        passage.text = documentSlice(
          property,
          typeof value === "string" ? value : "",
          passage.charOffset,
          passage.charLength,
        ).content as string;
      }
      return { rank: i + 1, entity: entityReference(loaded, hit, entity), passage };
    });
  return { ran: result.ran, items, limitations };
}

/** The indices the request's scope selects, in key order, and the types
 * its filters are checked against. A scope field the lens cannot serve is
 * an error at its path; a named type or document without a managed
 * passage index to search a limitation. */
function scopeOf(
  loaded: LoadedSchema,
  request: PassageSearchRequest,
  searchable: SearchIndexRecord[],
  errors: Record<string, string>,
  limitations: SearchLimitation[],
): { selected: SearchIndexRecord[]; scopeTypes: string[] } {
  // A passage returns its text: an index over a document the lens hides
  // does not serve.
  const readable = searchable.filter((index) => shownDocument(loaded, index) !== null);
  const managed = readable.filter((index) => index.kind === "passage");
  const named = SCOPE_FIELDS.filter((field) => request[field] !== undefined);
  for (const field of named.slice(1)) errors[field] = "Name one of types, documents or indices";
  const { types, documents, indices } = request;

  if (indices !== undefined) {
    const selected = namedIndices(indices, searchable, errors).filter((index) => readable.includes(index));
    indices.forEach((key, i) => {
      if (errors[`indices.${i}`] === undefined && !readable.some((index) => index.key === key)) {
        errors[`indices.${i}`] = `Search index '${key}' reads no document this lens shows`;
      }
    });
    return { selected, scopeTypes: rootTypes(selected) };
  }

  if (documents !== undefined) {
    if (documents.length === 0) errors.documents = "Name at least one document, or omit documents";
    const shown: { type: string; property: string }[] = [];
    documents.forEach((name, i) => {
      const [type = "", property, ...rest] = name.split(".");
      const entityType = loaded.scoped.entityTypes[type];
      if (property === undefined || rest.length > 0) {
        errors[`documents.${i}`] = "Expected entityType.property";
      } else if (entityType === undefined) {
        errors[`documents.${i}`] = `Entity type '${type}' not found`;
      } else if (entityType.properties[property] === undefined) {
        errors[`documents.${i}`] = `Property '${property}' not found on entity type '${type}'`;
      } else if (entityType.properties[property]!.dataType !== "document") {
        errors[`documents.${i}`] = `Property '${property}' of entity type '${type}' is not a document`;
      } else {
        shown.push({ type, property });
      }
    });
    const isNamed = (index: SearchIndexRecord, { type, property }: (typeof shown)[number]) =>
      index.definition.entityType === type && shownDocument(loaded, index) === property;
    const selected = managed.filter((index) => shown.some((document) => isNamed(index, document)));
    const unsearchable = shown.filter((document) => !selected.some((index) => isNamed(index, document)));
    if (unsearchable.length > 0) {
      limitations.push({
        code: "not-searchable",
        message: "These documents have no passage index this lens can search",
        documents: [...new Set(unsearchable.map(({ type, property }) => `${type}.${property}`))],
      });
    }
    return { selected, scopeTypes: [...new Set(shown.map(({ type }) => type))] };
  }

  if (types !== undefined) {
    const message = "These entity types have no passage index this lens can search";
    return namedTypes(loaded, types, managed, errors, limitations, message);
  }
  return { selected: managed, scopeTypes: Object.keys(loaded.scoped.entityTypes) };
}
