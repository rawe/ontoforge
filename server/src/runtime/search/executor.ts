/**
 * Run a search tree (`core/searchTree.ts`) over the indices' active
 * generations:
 *
 * 1. Each search node gets the ready generation of its index in its method
 *    (`availability.ts`, from the generations read once per tree) and every
 *    restrict above it, pushed into its own database query: the filters'
 *    exact conditions and ids of its root type, with the lens's hidden
 *    relation and target types and the node's parts. A search node that
 *    cannot run returns an empty ranking and is noted as a limitation, one
 *    per reason and method naming its indices; a fuse left with a single
 *    ranking of search nodes that ran passes it on — a hybrid search with
 *    one method to run keeps that method's scores.
 * 2. Each semantic query text is embedded once; the search nodes run in
 *    parallel, each first fetching `limit × 4` entries of the nearest cut
 *    above it (its depth). A semantic floor drops the entries below it
 *    after the fetch.
 * 3. Bottom-up (`core/searchQuery.ts`): merge by raw score, group by
 *    entity or by passage — entity, document, chunk ordinal; the best
 *    entry scores it — and fuse by reciprocal rank, the one tie rule for
 *    every fuse (`byScore`). If a cut gets fewer than `limit` items, its
 *    search nodes not yet exhausted fetch once more, up to a fixed cap —
 *    never more — and the tree is combined again.
 * 4. A cut keeps its first `limit` items, at most `perEntity` passages per
 *    entity; an append adds its filters' ids the ranking missed. Each item
 *    of the root carries what found it: per search — sub-query and query
 *    text — the hit, per index.
 *
 * It runs the trees the compilers build today: passages rank only as the
 * methods of one search, fused.
 */

import { getEmbeddingProvider } from "../../core/embedding.js";
import { ValidationError } from "../../core/exceptions.js";
import type {
  FilterCondition,
  RankedSearchEntry,
  SearchGenerationRecord,
  SearchIndexRecord,
  SearchIndexStore,
} from "../../core/ports.js";
import { documentField } from "../../core/searchComposition.js";
import type { SearchRepresentation } from "../../core/searchIndex.js";
import { byScore, fuseModes, mergeByScore, RRF_K, type FusedHit, type ModeRanking } from "../../core/searchQuery.js";
import {
  isSearchNode,
  searchMethod,
  type CutNode,
  type GroupNode,
  type SearchNode,
  type TreeNode,
} from "../../core/searchTree.js";
import type { LoadedSchema } from "../schemaCache.js";
import { indexAvailability, type Unavailable } from "./availability.js";
import type { EngineHit, IndexMatch, MethodScores } from "./indexSearch.js";

/** Entries a search node first fetches per entity its cut keeps. */
const OVERFETCH_FACTOR = 4;

/** The most entries one search node fetches. */
const ENTRY_FETCH_CAP = 1000;

/** What a tree run returns: the root ranking and what could not run. */
export interface TreeResult {
  hits: TreeHit[];
  limitations: Limitation[];
}

/** The search nodes of one method that could not run for one reason: their
 * indices, in tree order. */
export interface Limitation {
  code: Unavailable["reason"];
  method: SearchRepresentation;
  indices: string[];
}

/** One item of the root ranking — an entity, or a passage of one, its
 * hit's entry — with what found it. */
export interface TreeHit {
  entityId: string;
  entityType: string;
  /** Per search that found or listed the entity, in tree order. */
  provenance: Provenance[];
}

/** One search's part in an item of the root ranking. */
export interface Provenance {
  /** The plan's sub-query; null when the tree has none. */
  subQuery: number | null;
  /** The query text; null when an append listed the entity. */
  text: string | null;
  /** What the search found of the entity; null when listed. */
  hit: EngineHit | null;
}

/** What restricts the entities of one type: exact conditions, and the
 * ids they must be among (null: any). */
interface Restriction {
  conditions: FilterCondition[];
  ids: readonly string[] | null;
}

/** A search node as it runs: its generation, the restriction pushed down
 * to it and its nearest cut. */
interface Planned {
  node: SearchNode;
  index: SearchIndexRecord;
  method: SearchRepresentation;
  /** Absent: the search node cannot run. */
  generation: SearchGenerationRecord | undefined;
  restriction: Restriction | undefined;
  /** The nearest cut above: its limit sets the depth. */
  cut: CutNode;
}

interface Fetched {
  entries: RankedSearchEntry[];
  /** Fetching more would add nothing: the ranking ran out (or past the
   * floor). */
  exhausted: boolean;
}

/** An entry with the search node it came from. */
type FoundEntry = RankedSearchEntry & { search: number };

/** An item of a ranking above the methods' fusion. */
interface Item extends TreeHit {
  /** Its order's score: raw, or the reciprocal ranks summed. */
  score: number;
  /** The best semantic similarity of the entries that found it; null when
   * none did semantically. */
  similarity: number | null;
}

/** A node's ranking: the entries of one method; entities or passages —
 * `key`, each named by `keyOf` — with the method rankings they come from;
 * or items above that, with what found them. `ran` is false for the empty
 * ranking of a search node that cannot run, and of what combines only
 * such. */
type Combined = (
  | { unit: "entries"; method: SearchRepresentation; entries: FoundEntry[] }
  | {
      unit: "grouped";
      key: GroupNode["key"];
      keyOf: (entry: FoundEntry) => string;
      rankings: ModeRanking<FoundEntry>[];
      hits: FusedHit<FoundEntry>[];
    }
  | { unit: "items"; key: GroupNode["key"]; items: Item[] }
) & { ran: boolean };

/** Run a valid tree; `indices` holds every index its search nodes name. */
export async function executeSearchTree(
  loaded: LoadedSchema,
  indexStore: SearchIndexStore,
  indices: ReadonlyMap<string, SearchIndexRecord>,
  tree: TreeNode,
): Promise<TreeResult> {
  const provider = getEmbeddingProvider();
  const searches = planSearches(tree, indices);
  const limitations: Limitation[] = [];
  if (searches.length > 0) {
    // Read for this tree only: any instance's worker may build them.
    const generations = await indexStore.listGenerations();
    for (const search of searches) {
      const availability = indexAvailability(search.index, search.method, generations);
      if (availability.runs) search.generation = availability.generation;
      else note(limitations, availability.reason, search);
    }
  }

  const vectors = new Map<string, number[]>();
  for (const search of searches) {
    if (search.generation === undefined || search.method !== "semantic" || vectors.has(search.node.text)) continue;
    const embedded = await provider!.embed(search.node.text);
    if (!embedded) throw new ValidationError("Failed to generate embedding for search query");
    vectors.set(search.node.text, embedded);
  }

  // The lens's hidden relation and target types.
  const scoped = loaded.searchIndexScope.scoped;
  const lensRelations = scoped ? Object.keys(loaded.scoped.relationTypes) : null;
  const targetTypes = scoped ? Object.keys(loaded.scoped.entityTypes) : null;

  const fetchSearch = async (search: Planned, limit: number): Promise<Fetched> => {
    const own = search.node.relations;
    const raw = await indexStore.rankEntries({
      generationId: search.generation!.generationId,
      ...(search.node.kind === "semanticSearch"
        ? { vector: vectors.get(search.node.text) }
        : { text: search.node.text, matching: search.node.match }),
      conditions: search.restriction?.conditions ?? [],
      entityIds: search.restriction?.ids ?? null,
      relationTypes:
        own === null ? lensRelations : own.filter((key) => lensRelations === null || lensRelations.includes(key)),
      targetTypes,
      ...(search.node.parts === undefined ? {} : { partKinds: search.node.parts }),
      limit,
    });
    const floor = search.node.kind === "semanticSearch" ? (search.node.minSimilarity ?? null) : null;
    const entries = floor === null ? raw : raw.filter((entry) => entry.score >= floor);
    const exhausted = raw.length < limit || (floor !== null && raw.at(-1)!.score < floor);
    return { entries, exhausted };
  };

  const depth = (search: Planned) => Math.min(search.cut.limit * OVERFETCH_FACTOR, ENTRY_FETCH_CAP);
  let fetched = await Promise.all(
    searches.map((search) => (search.generation === undefined ? null : fetchSearch(search, depth(search)))),
  );
  let combined = combineTree(tree, searches, fetched, loaded);
  // Once more, the search nodes not yet exhausted under a cut that came
  // out short.
  const short = (search: Planned, i: number) =>
    fetched[i] !== null &&
    !fetched[i]!.exhausted &&
    depth(search) < ENTRY_FETCH_CAP &&
    (combined.counts.get(search.cut) ?? 0) < search.cut.limit;
  if (searches.some(short)) {
    fetched = await Promise.all(
      searches.map((search, i) => (short(search, i) ? fetchSearch(search, ENTRY_FETCH_CAP) : (fetched[i] ?? null))),
    );
    combined = combineTree(tree, searches, fetched, loaded);
  }
  const hits = itemsOf(combined.root, searches).map(({ entityId, entityType, provenance }) => ({
    entityId,
    entityType,
    provenance,
  }));
  return { hits, limitations };
}

/** A search node that cannot run, in the limitation of its reason and
 * method. */
function note(limitations: Limitation[], code: Limitation["code"], search: Planned): void {
  let limitation = limitations.find((l) => l.code === code && l.method === search.method);
  if (limitation === undefined) {
    limitation = { code, method: search.method, indices: [] };
    limitations.push(limitation);
  }
  if (!limitation.indices.includes(search.index.key)) limitation.indices.push(search.index.key);
}

/** The search nodes in tree order, each with the restrictions pushed down
 * to it and its nearest cut. */
function planSearches(tree: TreeNode, indices: ReadonlyMap<string, SearchIndexRecord>): Planned[] {
  const searches: Planned[] = [];
  const plan = (node: TreeNode, restrictions: ReadonlyMap<string, Restriction>, cut: CutNode | undefined): void => {
    if (isSearchNode(node)) {
      if (cut === undefined) throw new Error("A search node needs a cut above it: its depth comes from the cut's limit");
      const index = indices.get(node.index)!;
      const restriction = restrictions.get(index.definition.entityType);
      searches.push({ node, index, method: searchMethod(node), generation: undefined, restriction, cut });
      return;
    }
    switch (node.kind) {
      case "restrict": {
        const narrowed = new Map(restrictions);
        for (const filter of node.filters) {
          const { entityType, restriction } = restrictionOf(filter);
          narrowed.set(entityType, both(narrowed.get(entityType), restriction));
        }
        plan(node.input, narrowed, cut);
        return;
      }
      case "merge":
      case "fuse":
        for (const input of node.inputs) plan(input, restrictions, cut);
        return;
      case "group":
        plan(node.input, restrictions, cut);
        return;
      case "cut":
        plan(node.input, restrictions, node);
        return;
      case "append":
        // Its filters only list.
        if (node.input !== null) plan(node.input, restrictions, cut);
        return;
      default:
        throw new Error(`A search tree with '${node.kind}' here cannot run`);
    }
  };
  plan(tree, new Map(), undefined);
  return searches;
}

/** A filter as the restriction of its entity type. */
function restrictionOf(filter: TreeNode): { entityType: string; restriction: Restriction } {
  if (filter.kind !== "filter") throw new Error(`'${filter.kind}' is not a filter`);
  return { entityType: filter.entityType, restriction: { conditions: filter.conditions, ids: filter.ids } };
}

/** Both restrictions at once: every condition, the ids in both. */
function both(a: Restriction | undefined, b: Restriction): Restriction {
  if (a === undefined) return b;
  return {
    conditions: [...a.conditions, ...b.conditions],
    ids: a.ids === null ? b.ids : b.ids === null ? a.ids : a.ids.filter((id) => b.ids!.includes(id)),
  };
}

/** The root's ranking, and per cut the items its input ranked, as many
 * per entity as it keeps. */
function combineTree(tree: TreeNode, searches: Planned[], fetched: (Fetched | null)[], loaded: LoadedSchema) {
  const searchOf = new Map(searches.map((search, i) => [search.node as TreeNode, i] as const));
  const counts = new Map<CutNode, number>();
  // The document each search node's index reads, once.
  const documents = new Map<number, string | null>();
  const documentOf = (search: number) => {
    if (!documents.has(search)) documents.set(search, documentField(searches[search]!.index.definition, loaded.full));
    return documents.get(search)!;
  };
  /** What an entry is an item of: its entity, or its passage. Keys hold
   * no `/`. */
  const keyOf = (key: GroupNode["key"]) => (entry: FoundEntry) => {
    if (key === "entity") return entry.entityId;
    if (entry.partKind !== "passage") throw new Error("A passage group takes passage entries only");
    return `${entry.entityId}/${documentOf(entry.search)}/${entry.partId}`;
  };
  const grouped = (key: GroupNode["key"], rankings: ModeRanking<FoundEntry>[], ran: boolean): Combined => {
    const itemOf = keyOf(key);
    return { unit: "grouped", key, keyOf: itemOf, rankings, hits: fuseModes(rankings, itemOf), ran };
  };

  /** A node's ranking, bottom-up. */
  const combine = (node: TreeNode): Combined => {
    switch (node.kind) {
      case "keywordSearch":
      case "semanticSearch": {
        const search = searchOf.get(node)!;
        const own = fetched[search]!;
        if (own === null) return { unit: "entries", method: searchMethod(node), entries: [], ran: false };
        // Best first, as the port ranks them; equal scores keep their order.
        const entries = mergeByScore([own.entries.map((entry) => ({ ...entry, search }))]);
        return { unit: "entries", method: searchMethod(node), entries, ran: true };
      }
      case "merge": {
        const merged = node.inputs.map(combine).map(entriesOf);
        const entries = mergeByScore(merged.map((input) => input.entries));
        return { unit: "entries", method: merged[0]!.method, entries, ran: merged.some((input) => input.ran) };
      }
      case "group": {
        const input = entriesOf(combine(node.input));
        return grouped(node.key, [{ representation: input.method, entries: input.entries }], input.ran);
      }
      case "fuse": {
        const all = node.inputs.map(combine);
        // The empty rankings of what cannot run do not count.
        const fused = all.filter((input) => input.ran);
        if (fused.length <= 1) return fused[0] ?? all[0]!;
        // The methods of one search fuse by their entries; anything else
        // as rankings of entities.
        const methods = fused.flatMap((input) =>
          input.unit === "grouped" && input.rankings.length === 1 ? [input] : [],
        );
        if (methods.length === fused.length) {
          return grouped(methods[0]!.key, methods.flatMap((input) => input.rankings), true);
        }
        if (fused.some((input) => input.unit !== "entries" && input.key === "passage")) {
          throw new Error("Passages fuse only as the methods of one search");
        }
        const items = fuseItems(fused.map((input) => itemsOf(input, searches)));
        return { unit: "items", key: "entity", items, ran: true };
      }
      case "restrict":
        // Pushed into the search nodes.
        return combine(node.input);
      case "append": {
        const items = node.input === null ? [] : itemsOf(combine(node.input), searches);
        const listed = new Set(items.map((item) => item.entityId));
        for (const filter of node.filters) {
          if (filter.kind !== "filter" || filter.ids === null) throw new Error("An append lists the ids of its filters");
          for (const entityId of [...filter.ids].sort()) {
            if (items.length >= node.until) break;
            if (listed.has(entityId)) continue;
            listed.add(entityId);
            const provenance: Provenance = { subQuery: node.subQuery ?? null, text: null, hit: null };
            items.push({ entityId, entityType: filter.entityType, score: 0, similarity: null, provenance: [provenance] });
          }
        }
        // A list, whether or not its search ran.
        return { unit: "items", key: "entity", items, ran: true };
      }
      case "cut": {
        const input = combine(node.input);
        if (input.unit === "entries") throw new Error("A cut ranks entities or passages");
        if (input.unit === "items") {
          const items = perEntity(input.items, node.perEntity);
          counts.set(node, items.length);
          return { unit: "items", key: input.key, items: items.slice(0, node.limit), ran: input.ran };
        }
        const hits = perEntity(input.hits, node.perEntity);
        counts.set(node, hits.length);
        const items = itemsOf({ ...input, hits: hits.slice(0, node.limit) }, searches);
        return { unit: "items", key: input.key, items, ran: input.ran };
      }
      default:
        throw new Error(`A search tree with '${node.kind}' here cannot run`);
    }
  };
  return { root: combine(tree), counts };
}

/** At most `cap` items per entity, in rank order; no cap: all. */
function perEntity<T extends { entityId: string }>(items: readonly T[], cap: number | undefined): T[] {
  if (cap === undefined) return [...items];
  const kept = new Map<string, number>();
  return items.filter((item) => {
    const count = (kept.get(item.entityId) ?? 0) + 1;
    kept.set(item.entityId, count);
    return count <= cap;
  });
}

function entriesOf(input: Combined): Extract<Combined, { unit: "entries" }> {
  if (input.unit !== "entries") throw new Error("Only entries merge and group yet");
  return input;
}

/** A ranking's items with what found them: a fusion of methods hit by
 * hit, its search — the matched search node's sub-query and query text —
 * as their provenance. */
function itemsOf(input: Combined, searches: Planned[]): Item[] {
  if (input.unit === "items") return input.items;
  if (input.unit === "entries") throw new Error("Only grouped items rank above a group");
  return input.hits.map((hit) => {
    const hitOf = toEngineHit(hit, searches, input.rankings, input.keyOf);
    const { node } = searches[hit.matched.entry.search]!;
    return {
      entityId: hit.entityId,
      entityType: hitOf.entityType,
      score: hit.score,
      similarity: hit.modes.find((mode) => mode.representation === "semantic")?.entry.score ?? null,
      provenance: [{ subQuery: node.subQuery ?? null, text: node.text, hit: hitOf }],
    };
  });
}

/** Rankings of entities as one by reciprocal rank (k = 60), ties by the
 * one rule; an entity keeps what found it in every ranking, in their
 * order. */
function fuseItems(rankings: Item[][]): Item[] {
  const fused = new Map<string, Item>();
  for (const ranking of rankings) {
    ranking.forEach((item, i) => {
      const contribution = 1 / (RRF_K + i + 1);
      const prior = fused.get(item.entityId);
      if (prior === undefined) {
        fused.set(item.entityId, { ...item, score: contribution, provenance: [...item.provenance] });
        return;
      }
      prior.score += contribution;
      if (item.similarity !== null && (prior.similarity === null || item.similarity > prior.similarity)) {
        prior.similarity = item.similarity;
      }
      prior.provenance.push(...item.provenance);
    });
  }
  return byScore([...fused.values()], (item) => item.similarity);
}

/** Same entry: same part of the same entity. */
function sameEntry(a: RankedSearchEntry, b: RankedSearchEntry): boolean {
  return a.partKind === b.partKind && a.groupNo === b.groupNo && a.partId === b.partId;
}

/** Without the ranking bookkeeping. */
function plain({ search: _search, ...entry }: FoundEntry): RankedSearchEntry {
  return entry;
}

function toEngineHit(
  hit: FusedHit<FoundEntry>,
  searches: Planned[],
  rankings: ModeRanking<FoundEntry>[],
  keyOf: (entry: FoundEntry) => string,
): EngineHit {
  const matchedSearch = searches[hit.matched.entry.search]!;
  const item = keyOf(hit.matched.entry);
  // The item's entries per method, the matched method first; per index
  // the first of them — the best of the method it ranks best in —
  // represents it, and is measured wherever a search node fetched that
  // very entry.
  const ordered = [...rankings].sort(
    (a, b) =>
      Number(b.representation === hit.matched.representation) -
      Number(a.representation === hit.matched.representation),
  );
  const own = ordered.map((ranking) => ({
    representation: ranking.representation,
    entries: ranking.entries.filter((entry) => keyOf(entry) === item),
  }));
  const primaries = new Map<string, FoundEntry>();
  for (const { entries } of own) {
    for (const entry of entries) {
      const key = searches[entry.search]!.index.key;
      if (!primaries.has(key)) primaries.set(key, entry);
    }
  }
  const indices: IndexMatch[] = [...primaries].map(([key, primary]) => {
    const measured = (representation: SearchRepresentation) =>
      own
        .find((method) => method.representation === representation)
        ?.entries.find((entry) => searches[entry.search]!.index.key === key && sameEntry(entry, primary))?.score ?? null;
    return {
      index: searches[primary.search]!.index,
      entry: plain(primary),
      semanticSimilarity: measured("semantic"),
      keywordScore: measured("keyword"),
    };
  });
  // Every method that fetched the matched entry itself measures it.
  const scores: MethodScores = {};
  for (const representation of ["semantic", "keyword"] as const) {
    const score = own
      .find((method) => method.representation === representation)
      ?.entries.find(
        (entry) =>
          searches[entry.search]!.index.key === matchedSearch.index.key && sameEntry(entry, hit.matched.entry),
      )?.score;
    if (score !== undefined) scores[representation] = score;
  }
  return {
    entityId: hit.entityId,
    entityType: matchedSearch.index.definition.entityType,
    score: hit.score,
    matched: { index: matchedSearch.index, entry: plain(hit.matched.entry), scores },
    indices,
  };
}
