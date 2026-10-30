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
 *    text — the hit, per index, and the item's rank in that text's ranking.
 *    Where one fusion ranks several query texts, each text's rankings are
 *    fused alone for that: the item's hit and rank per text.
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
  /** The item's rank, from 1, in the ranking of this query text alone;
   * null when listed. */
  rank: number | null;
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
      /** The query text of each ranking, in the same order. */
      texts: string[];
      hits: FusedHit<FoundEntry>[];
      /** Per query text, in tree order, its rankings fused alone. */
      byText: TextRanking[];
    }
  | { unit: "items"; key: GroupNode["key"]; items: Item[] }
) & { ran: boolean };

/** One query text's rankings fused alone: each item's hit and rank in
 * them, by the item's key. */
interface TextRanking {
  rankings: ModeRanking<FoundEntry>[];
  ranked: Map<string, { hit: FusedHit<FoundEntry>; rank: number }>;
}

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
  // Each group's ranking with its search, and whether rankings of entities
  // fused: then a query text's rankings may lie in several of them.
  const groups: { search: SearchNode; ranking: ModeRanking<FoundEntry> }[] = [];
  let fusedItems = false;
  const textRankings = new Map<string, TextRanking>();
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
  const grouped = (
    key: GroupNode["key"],
    rankings: ModeRanking<FoundEntry>[],
    texts: string[],
    ran: boolean,
  ): Combined => {
    const itemOf = keyOf(key);
    const hits = fuseModes(rankings, itemOf);
    const rankedBy = (fused: FusedHit<FoundEntry>[]) =>
      new Map(fused.map((hit, i) => [itemOf(hit.matched.entry), { hit, rank: i + 1 }] as const));
    const distinct = [...new Set(texts)];
    // One text: the whole ranking is its own.
    const byText =
      distinct.length === 1
        ? [{ rankings, ranked: rankedBy(hits) }]
        : distinct.map((text) => {
            const own = rankings.filter((_, i) => texts[i] === text);
            return { rankings: own, ranked: rankedBy(fuseModes(own, itemOf)) };
          });
    return { unit: "grouped", key, keyOf: itemOf, rankings, texts, hits, byText, ran };
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
        const ranking = { representation: input.method, entries: input.entries };
        if (input.ran) groups.push({ search: searchNodeOf(node.input), ranking });
        return grouped(node.key, [ranking], [textOf(node.input)], input.ran);
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
          return grouped(
            methods[0]!.key,
            methods.flatMap((input) => input.rankings),
            methods.flatMap((input) => input.texts),
            true,
          );
        }
        if (fused.some((input) => input.unit !== "entries" && input.key === "passage")) {
          throw new Error("Passages fuse only as the methods of one search");
        }
        const items = fuseItems(fused.map((input) => itemsOf(input, searches)));
        fusedItems = true;
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
            const provenance: Provenance = { subQuery: node.subQuery ?? null, text: null, hit: null, rank: null };
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
  const root = combine(tree);
  if (!fusedItems || root.unit !== "items") return { root, counts };
  return { root: { ...root, items: root.items.map((item) => ({ ...item, provenance: byOwnText(item) })) }, counts };

  /** An item's provenance, one per sub-query and query text: the hit and
   * rank of that text's ranking alone — every group's ranking of it in
   * the tree, its methods fused — whatever branches they were cut in. */
  function byOwnText(item: Item): Provenance[] {
    const provenance: Provenance[] = [];
    const done = new Set<string>();
    for (const row of item.provenance) {
      if (row.hit === null) {
        provenance.push(row);
        continue;
      }
      const text = `${row.subQuery}\u0000${row.text}`;
      if (done.has(text)) continue;
      done.add(text);
      const { rankings, ranked } = textRanking(row.subQuery, row.text!);
      const own = ranked.get(item.entityId);
      if (own === undefined) {
        provenance.push(row);
        continue;
      }
      const hit = toEngineHit(own.hit, searches, rankings, entityOf);
      provenance.push({ ...row, hit, rank: own.rank });
    }
    return provenance;
  }

  function textRanking(subQuery: number | null, text: string) {
    const key = `${subQuery}\u0000${text}`;
    let found = textRankings.get(key);
    if (found === undefined) {
      const rankings = groups
        .filter(({ search }) => (search.subQuery ?? null) === subQuery && search.text === text)
        .map(({ ranking }) => ranking);
      const ranked = new Map(fuseModes(rankings, entityOf).map((hit, i) => [hit.entityId, { hit, rank: i + 1 }] as const));
      found = { rankings, ranked };
      textRankings.set(key, found);
    }
    return found;
  }
}

const entityOf = (entry: FoundEntry) => entry.entityId;

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

/** The query text of the entries a group takes: its search nodes share
 * one (R1). */
function textOf(node: TreeNode): string {
  return searchNodeOf(node).text;
}

/** The first search node of the entries a group takes. */
function searchNodeOf(node: TreeNode): SearchNode {
  if (isSearchNode(node)) return node;
  if (node.kind === "merge" && node.inputs[0] !== undefined) return searchNodeOf(node.inputs[0]);
  if (node.kind === "restrict") return searchNodeOf(node.input);
  throw new Error(`A group takes entries; '${node.kind}' yields none`);
}

/** A ranking's items with what found them: a fusion of methods hit by
 * hit, its search — the matched search node's sub-query and query text —
 * as their provenance. A fusion of several query texts gives one
 * provenance per text that found the item, in tree order: the hit of that
 * text's rankings alone. */
function itemsOf(input: Combined, searches: Planned[]): Item[] {
  if (input.unit === "items") return input.items;
  if (input.unit === "entries") throw new Error("Only grouped items rank above a group");
  const provenanceOf = (hit: FusedHit<FoundEntry>, rankings: ModeRanking<FoundEntry>[], rank: number): Provenance => {
    const { node } = searches[hit.matched.entry.search]!;
    const hitOf = toEngineHit(hit, searches, rankings, input.keyOf);
    return { subQuery: node.subQuery ?? null, text: node.text, hit: hitOf, rank };
  };
  return input.hits.map((hit) => {
    const item = input.keyOf(hit.matched.entry);
    const provenance =
      input.byText.length === 1
        ? [provenanceOf(hit, input.rankings, input.byText[0]!.ranked.get(item)!.rank)]
        : input.byText.flatMap(({ rankings, ranked }) => {
            const own = ranked.get(item);
            return own === undefined ? [] : [provenanceOf(own.hit, rankings, own.rank)];
          });
    return {
      entityId: hit.entityId,
      entityType: provenance[0]!.hit!.entityType,
      score: hit.score,
      similarity: hit.modes.find((mode) => mode.representation === "semantic")?.entry.score ?? null,
      provenance,
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
  // A method's score of this very entry: its own in the method that
  // fetched it, else from the first ranking of the method, in tree order,
  // that fetched it too.
  const measured = (representation: SearchRepresentation, target: FoundEntry) => {
    if (searches[target.search]!.method === representation) return target.score;
    const key = searches[target.search]!.index.key;
    return own
      .filter((method) => method.representation === representation)
      .flatMap((method) => method.entries)
      .find((entry) => searches[entry.search]!.index.key === key && sameEntry(entry, target))?.score;
  };
  const indices: IndexMatch[] = [...primaries.values()].map((primary) => ({
    index: searches[primary.search]!.index,
    entry: plain(primary),
    semanticSimilarity: measured("semantic", primary) ?? null,
    keywordScore: measured("keyword", primary) ?? null,
  }));
  // Every method that fetched the matched entry itself measures it.
  const scores: MethodScores = {};
  for (const representation of ["semantic", "keyword"] as const) {
    const score = measured(representation, hit.matched.entry);
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
