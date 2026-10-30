/**
 * A named search's tree against its lens (`core/namedSearch.ts` holds the
 * stored form): each stored filter's conditions resolved against its
 * entity type through the lens, no search below a passage group over a
 * document the lens hides, then the tree's rules R1–R8
 * (`validateSearchTree`) — every failure at its path below `tree`. The
 * same check serves the save, the import and the run.
 *
 * The runtime listing and the run by key
 * (`docs/capabilities/named-searches.md`):
 *
 * 1. The query goes in place of every `$query`; the tree is checked
 *    against the lens again — one it no longer fits is refused, never run.
 * 2. The run's `filter`, in the entity search's filter syntax, applies to
 *    the root types of the indices the tree searches: per type that
 *    resolves every key a filter, a type that does not none of its
 *    entities, all in one restrict directly under the root cut (around
 *    the root when that is no cut). A key no type resolves is an error;
 *    no type left an empty result and a limitation.
 * 3. The executor runs it; a search node that cannot run — a semantic one
 *    without an embedding provider too — is a limitation.
 * 4. The response is the entity or the passage search's, by the root's
 *    unit. Each item's match comes from the query text the item ranked
 *    best in — by its rank in that text's ranking, ties to the earlier
 *    text in the tree — and names that text as `queryText` when the tree
 *    searches more than one.
 */

import { getEmbeddingProvider } from "../../core/embedding.js";
import { NotFoundError, ValidationError } from "../../core/exceptions.js";
import {
  namedSearchResult,
  storedInputs,
  storedSearchNodes,
  treePath,
  withQuery,
  type StoredSearchNode,
} from "../../core/namedSearch.js";
import type { RuntimeStore, SearchIndexRecord, SearchPartKind } from "../../core/ports.js";
import { documentField } from "../../core/searchComposition.js";
import type { SearchRepresentation } from "../../core/searchIndex.js";
import {
  isSearchNode,
  searchMethod,
  validateSearchTree,
  type FilterNode,
  type SearchNode,
  type SearchTreeViolation,
  type TreeNode,
} from "../../core/searchTree.js";
import { loadSchema, type LoadedSchema } from "../schemaCache.js";
import { entitySearchItems, type EntitySearchResponse } from "./entitySearch.js";
import type { Provenance, TreeHit } from "./executor.js";
import { resolveSearchFilters } from "./filters.js";
import { indexStoreOf, readHitEntities, runSearchTree, searchableIndices } from "./indexSearch.js";
import { passageSearchItems, readPassageEntities, type PassageSearchResponse } from "./passageSearch.js";
import { described, rootTypes, shownDocument, type SearchLimitation } from "./scopedSearch.js";

/** What a tree is checked against: the lens's schema, the indices it may
 * search, and whether the adapter's search evaluates relation
 * conditions. */
export interface NamedSearchLens {
  loaded: Pick<LoadedSchema, "scoped">;
  /** The keys of the indices the lens may search. */
  indices: ReadonlySet<string>;
  /** Of those, the keys of the ones that read a document the lens hides:
   * as in the passage search, a search below a passage group may not name
   * one — its passages would carry no document and no text. */
  hiddenDocuments: ReadonlySet<string>;
  store: Pick<RuntimeStore, "supportsSearchPathConditions">;
}

/** A lens to check a tree against, from its schema before and after its
 * scope and the indices it may search. */
export function namedSearchLens(
  loaded: Pick<LoadedSchema, "full" | "scoped">,
  searchable: readonly SearchIndexRecord[],
  store: NamedSearchLens["store"],
): NamedSearchLens {
  const hidesDocument = (index: SearchIndexRecord) =>
    documentField(index.definition, loaded.full) !== null && shownDocument(loaded, index) === null;
  return {
    loaded,
    indices: new Set(searchable.map((index) => index.key)),
    hiddenDocuments: new Set(searchable.filter(hidesDocument).map((index) => index.key)),
    store,
  };
}

/** The tree as the executor runs it, and every rule it breaks against
 * the lens, each as `<path>: <message>`; the tree only when there are
 * none. */
export function compileNamedSearch(
  tree: StoredSearchNode,
  lens: NamedSearchLens,
): { tree: TreeNode; errors: [] } | { tree: null; errors: string[] } {
  const errors: string[] = [];
  const compiled = compile(tree, "", lens, errors);
  for (const violation of validateSearchTree(compiled, {
    indices: lens.indices,
    entityTypes: new Set(Object.keys(lens.loaded.scoped.entityTypes)),
    model: getEmbeddingProvider()?.modelId ?? null,
  })) {
    errors.push(`${treePath(violationPath(violation, compiled))}: ${violation.message}`);
  }
  return errors.length === 0 ? { tree: compiled, errors: [] } : { tree: null, errors };
}

/** `passage`: below a passage group, where only passage entries count —
 * a search node without `parts` counts those only (the tree's rules refuse
 * other parts), and one over a document the lens hides is refused. */
function compile(
  at: StoredSearchNode,
  path: string,
  lens: NamedSearchLens,
  errors: string[],
  passage = false,
): TreeNode {
  const below = at.kind === "group" ? at.key === "passage" : passage;
  const input = (segment: string, of: StoredSearchNode) =>
    compile(of, path === "" ? segment : `${path}.${segment}`, lens, errors, below);
  const inputs = () => storedInputs(at).map(([segment, of]) => input(segment, of));
  let parts: SearchPartKind[] | undefined;
  if (at.kind === "keywordSearch" || at.kind === "semanticSearch") {
    parts = at.parts ?? (passage ? ["passage"] : undefined);
    if (passage && lens.hiddenDocuments.has(at.index)) {
      errors.push(`${treePath(path === "" ? "index" : `${path}.index`)}: Search index '${at.index}' reads no document this lens shows`);
    }
  }
  switch (at.kind) {
    case "keywordSearch":
      return {
        kind: "keywordSearch",
        index: at.index,
        text: at.text,
        match: at.match ?? "any",
        relations: at.relations ?? null,
        ...(parts === undefined ? {} : { parts }),
      };
    case "semanticSearch":
      return {
        kind: "semanticSearch",
        index: at.index,
        text: at.text,
        ...(at.minSimilarity === undefined ? {} : { minSimilarity: at.minSimilarity }),
        relations: at.relations ?? null,
        ...(parts === undefined ? {} : { parts }),
      };
    case "merge":
    case "fuse":
      return { kind: at.kind, inputs: inputs() };
    case "group":
      return { kind: "group", key: at.key, input: input("input", at.input) };
    case "cut":
      return {
        kind: "cut",
        input: input("input", at.input),
        limit: at.limit,
        ...(at.perEntity === undefined ? {} : { perEntity: at.perEntity }),
      };
    case "restrict": {
      const [first, ...filters] = inputs();
      return { kind: "restrict", input: first!, filters };
    }
    case "filter": {
      // A type the lens does not show is R7's; its conditions are not read.
      const type = lens.loaded.scoped.entityTypes[at.entityType];
      if (type === undefined) return { kind: "filter", entityType: at.entityType, conditions: [], ids: null };
      const fieldErrors: Record<string, string> = {};
      const [resolved] = resolveSearchFilters(at.conditions, [[at.entityType, type]], lens.loaded, lens.store, fieldErrors);
      for (const [key, message] of Object.entries(fieldErrors)) {
        errors.push(`${treePath(path)}.conditions.${key}: ${message}`);
      }
      return { kind: "filter", entityType: at.entityType, conditions: resolved?.conditions ?? [], ids: null };
    }
  }
}

/** Where a violation is reported: an unknown index or type, and a floor
 * where none belongs, at their field; every other rule at its node. */
function violationPath({ rule, path }: SearchTreeViolation, tree: TreeNode): string {
  const at = (field: string) => (path === "" ? field : `${path}.${field}`);
  if (rule === "R5") return at("minSimilarity");
  if (rule === "R7") return at(nodeAt(tree, path).kind === "filter" ? "entityType" : "index");
  return path;
}

/** The node at a path of the tree's own segments. */
function nodeAt(tree: TreeNode, path: string): TreeNode {
  const segments = path === "" ? [] : path.split(".");
  let at = tree as TreeNode & { input?: TreeNode; inputs?: TreeNode[]; filters?: TreeNode[] };
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    at = (segment === "input" ? at.input : at[segment as "inputs" | "filters"]![Number(segments[++i])]) as typeof at;
  }
  return at;
}

// ---------------------------------------------------------------------------
// Listing and running by key
// ---------------------------------------------------------------------------

/** A named search as the runtime lists it: no tree. */
export interface NamedSearchListing {
  key: string;
  name: string;
  description: string;
  /** What it ranks: the unit of its tree's root. */
  result: "entities" | "passages";
  /** The root types of the indices it searches that the lens can search,
   * sorted — what a run's `filter` applies to. */
  types: string[];
}

/** A run's request: the query text, and exact conditions as the entity
 * search's `filter`. */
export interface NamedSearchRunRequest {
  query: string;
  filter?: Record<string, string> | undefined;
}

/** The lens's named searches, by key, from the schema cache. */
export async function listNamedSearches(lensKey: string, store: RuntimeStore): Promise<NamedSearchListing[]> {
  const loaded = await loadSchema(lensKey, store);
  const searchable = await searchableIndices(loaded, indexStoreOf(store));
  const byKey = Object.values(loaded.namedSearches).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return byKey.map((search) => {
    const named = new Set(storedSearchNodes(search.tree).map((node) => node.index));
    return {
      key: search.key,
      name: search.name,
      description: search.description,
      result: namedSearchResult(search.tree),
      types: rootTypes(searchable.filter((index) => named.has(index.key))).sort(),
    };
  });
}

/** Run a named search by key with a query text (module comment). */
export async function runNamedSearch(
  lensKey: string,
  key: string,
  request: NamedSearchRunRequest,
  store: RuntimeStore,
): Promise<EntitySearchResponse | PassageSearchResponse> {
  const loaded = await loadSchema(lensKey, store);
  const search = loaded.namedSearches[key];
  if (search === undefined) throw new NotFoundError(`Named search '${key}' not found`);
  if (!request.query?.trim()) {
    throw new ValidationError("Required non-empty query", { fields: { query: "Required non-empty query" } });
  }

  const searchable = await searchableIndices(loaded, indexStoreOf(store));
  const compiled = compileNamedSearch(withQuery(search.tree, request.query), namedSearchLens(loaded, searchable, store));
  if (compiled.tree === null) {
    throw new ValidationError(`Named search '${key}' validation failed`, { errors: compiled.errors });
  }
  const nodes = searchNodesOf(compiled.tree);
  const indices = searchable.filter((index) => nodes.some((node) => node.index === index.key));
  const types = rootTypes(indices).sort();
  const limitations: SearchLimitation[] = [];

  let tree = compiled.tree;
  const filter = request.filter ?? {};
  if (Object.keys(filter).length > 0) {
    const filters = typeFilters(loaded, store, filter, types);
    if (filters === null) {
      limitations.push({
        code: "filter-excludes-all-types",
        message: "No searched entity type declares every filter key",
        types,
      });
      return { ran: [], items: [], limitations };
    }
    tree = restrictedUnderCut(tree, filters);
  }

  const result = await runSearchTree(loaded, indexStoreOf(store), indices, tree);
  for (const limitation of result.limitations) limitations.push(described(limitation));
  const ran = ranMethods(nodes, result.limitations);
  const multiText = new Set(nodes.map((node) => node.text)).size > 1;
  const picked = result.hits.map(bestMatch);
  const hits = picked.map((match) => match.hit!);

  if (namedSearchResult(search.tree) === "passages") {
    const entities = await readPassageEntities(loaded, store, hits, true);
    const kept = picked.filter((match) => entities.has(match.hit!.entityId));
    const items = passageSearchItems(loaded, hits, entities, true).map((item, i) =>
      multiText ? { ...item, passage: { ...item.passage, queryText: kept[i]!.text! } } : item,
    );
    return { ran, items, limitations };
  }
  const entities = await readHitEntities(loaded, store, hits, null);
  const kept = picked.filter((match) => entities.has(match.hit!.entityId));
  const items = (await entitySearchItems(loaded, store, kept.map((match) => match.hit!), entities)).map((item, i) =>
    multiText ? { ...item, match: { ...item.match, queryText: kept[i]!.text! } } : item,
  );
  return { ran, items, limitations };
}

/** The search nodes of a compiled tree, in tree order. */
function searchNodesOf(tree: TreeNode): SearchNode[] {
  if (isSearchNode(tree)) return [tree];
  switch (tree.kind) {
    case "merge":
    case "fuse":
      return tree.inputs.flatMap(searchNodesOf);
    case "group":
    case "cut":
    case "restrict":
      return searchNodesOf(tree.input);
    default:
      return [];
  }
}

/**
 * The run's `filter` as one filter per type: the conditions of a type
 * that resolves every key, no entity of one that does not. A key no type
 * resolves is an error at `filter.<key>`; null when no type is left.
 */
function typeFilters(
  loaded: LoadedSchema,
  store: RuntimeStore,
  filter: Record<string, string>,
  types: string[],
): FilterNode[] | null {
  const errors: Record<string, string> = {};
  const eligible = resolveSearchFilters(
    filter,
    types.map((type) => [type, loaded.scoped.entityTypes[type]!]),
    loaded,
    store,
    errors,
  );
  if (Object.keys(errors).length > 0) {
    const fields = Object.fromEntries(Object.entries(errors).map(([key, message]) => [`filter.${key}`, message]));
    throw new ValidationError(Object.values(fields).join("; "), { fields });
  }
  if (eligible.length === 0) return null;
  return types.map((entityType): FilterNode => {
    const resolved = eligible.find((type) => type.entityTypeKey === entityType);
    return resolved === undefined
      ? { kind: "filter", entityType, conditions: [], ids: [] }
      : { kind: "filter", entityType, conditions: resolved.conditions, ids: null };
  });
}

/** The tree with one restrict of `filters` directly under its root cut,
 * or around the root when that is no cut — pushed down like every
 * restrict, AND-ed with the tree's own. */
function restrictedUnderCut(tree: TreeNode, filters: FilterNode[]): TreeNode {
  if (tree.kind === "cut") return { ...tree, input: { kind: "restrict", input: tree.input, filters } };
  return { kind: "restrict", input: tree, filters };
}

/** The methods that ran on at least one search node, semantic first. */
function ranMethods(nodes: SearchNode[], limitations: { method: SearchRepresentation; indices: string[] }[]) {
  return (["semantic", "keyword"] as const).filter((method) =>
    nodes.some(
      (node) =>
        searchMethod(node) === method &&
        !limitations.some((limitation) => limitation.method === method && limitation.indices.includes(node.index)),
    ),
  );
}

/** What found an item, as a named search answers it: the search with the
 * best rank in its own text's ranking; equal ranks, the earlier in the
 * tree. */
function bestMatch(hit: TreeHit): Provenance {
  let best: Provenance | undefined;
  for (const row of hit.provenance) {
    if (row.hit === null || row.rank === null) continue;
    if (best === undefined || row.rank < best.rank!) best = row;
  }
  if (best === undefined) throw new Error("A named search's item is found by a search");
  return best;
}
