/**
 * Run a search tree (`core/searchTree.ts`) over the indices' active
 * generations:
 *
 * 1. Each search node gets the ready generation of its index in its method
 *    — semantic only of the embedding model in use — and every restrict
 *    above it, pushed into its own database query: the filters' exact
 *    conditions and ids of its root type, with the lens's hidden relation
 *    and target types. A search node without a ready generation, or whose
 *    index does not enable its method, contributes nothing; a layer left
 *    with a single input passes it on — a hybrid search with one method to
 *    run keeps that method's scores.
 * 2. Each semantic query text is embedded once; the search nodes run in
 *    parallel, each first fetching `limit × 4` entries of the nearest cut
 *    above it (its depth). A semantic floor drops the entries below it
 *    after the fetch.
 * 3. Bottom-up (`core/searchQuery.ts`): merge by raw score, group by
 *    entity — the best entry scores it — and fuse by reciprocal rank, the
 *    one tie rule for every fuse (`byScore`). If a cut gets fewer than
 *    `limit` entities, its search nodes not yet exhausted fetch once more,
 *    up to a fixed cap — never more — and the tree is combined again.
 * 4. A cut keeps its first `limit` entities; an append adds its filters'
 *    ids the ranking missed. Each entity of the root carries what found it:
 *    per search — sub-query and query text — the hit, per index.
 *
 * It runs the trees the compilers build today; passage results come with
 * the search that needs them.
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
import type { SearchRepresentation } from "../../core/searchIndex.js";
import { byScore, fuseModes, mergeByScore, RRF_K, type FusedHit, type ModeRanking } from "../../core/searchQuery.js";
import { isSearchNode, searchMethod, type CutNode, type SearchNode, type TreeNode } from "../../core/searchTree.js";
import type { LoadedSchema } from "../schemaCache.js";
import type { EngineHit, IndexMatch } from "./indexSearch.js";

/** Entries a search node first fetches per entity its cut keeps. */
const OVERFETCH_FACTOR = 4;

/** The most entries one search node fetches. */
const ENTRY_FETCH_CAP = 1000;

/** One entity of the root ranking, with what found it. */
export interface TreeHit {
  entityId: string;
  entityType: string;
  /** Per search that found or listed the entity, in tree order. */
  provenance: Provenance[];
}

/** One search's part in an entity of the root ranking. */
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

/** An entity of a ranking above the methods' fusion. */
interface Item extends TreeHit {
  /** Its order's score: raw, or the reciprocal ranks summed. */
  score: number;
  /** The best semantic similarity of the entries that found it; null when
   * none did semantically. */
  similarity: number | null;
}

/** A node's ranking: the entries of one method; entities with the method
 * rankings they come from; or entities above that, with what found them. */
type Combined =
  | { unit: "entries"; method: SearchRepresentation; entries: FoundEntry[] }
  | { unit: "entities"; rankings: ModeRanking<FoundEntry>[]; hits: FusedHit<FoundEntry>[] }
  | { unit: "items"; items: Item[] };

/** Run a valid tree; `indices` holds every index its search nodes name. */
export async function executeSearchTree(
  loaded: LoadedSchema,
  indexStore: SearchIndexStore,
  indices: ReadonlyMap<string, SearchIndexRecord>,
  tree: TreeNode,
): Promise<TreeHit[]> {
  const provider = getEmbeddingProvider();
  const searches = planSearches(tree, indices);
  if (searches.length > 0) {
    const ready = (await indexStore.listGenerations()).filter((g) => g.state === "ready");
    for (const search of searches) search.generation = generationOf(search, ready, provider?.modelId);
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
  let combined = combineTree(tree, searches, fetched);
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
    combined = combineTree(tree, searches, fetched);
  }
  if (combined.root === null) return [];
  return itemsOf(combined.root, searches).map(({ entityId, entityType, provenance }) => ({
    entityId,
    entityType,
    provenance,
  }));
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

/** The ready generation a search node ranks: of its index in its method,
 * semantic of the model in use; none when the index does not enable it. */
function generationOf(
  search: Planned,
  ready: SearchGenerationRecord[],
  modelId: string | undefined,
): SearchGenerationRecord | undefined {
  if (!search.index.definition[search.method].enabled) return undefined;
  return ready.find(
    (g) =>
      g.searchIndexId === search.index.searchIndexId &&
      g.representation === search.method &&
      (search.method === "keyword" || g.modelId === modelId),
  );
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

/** The root's ranking, and per cut the entities its input ranked. */
function combineTree(tree: TreeNode, searches: Planned[], fetched: (Fetched | null)[]) {
  const searchOf = new Map(searches.map((search, i) => [search.node as TreeNode, i] as const));
  const counts = new Map<CutNode, number>();

  /** A node's ranking, bottom-up; null when no search node below it runs. */
  const combine = (node: TreeNode): Combined | null => {
    const inputs = (nodes: TreeNode[]) => nodes.map(combine).filter((input): input is Combined => input !== null);
    switch (node.kind) {
      case "keywordSearch":
      case "semanticSearch": {
        const search = searchOf.get(node)!;
        const own = fetched[search]!;
        if (own === null) return null;
        // Best first, as the port ranks them; equal scores keep their order.
        const entries = mergeByScore([own.entries.map((entry) => ({ ...entry, search }))]);
        return { unit: "entries", method: searchMethod(node), entries };
      }
      case "merge": {
        const merged = inputs(node.inputs).map(entriesOf);
        if (merged.length === 0) return null;
        const entries = mergeByScore(merged.map((input) => input.entries));
        return { unit: "entries", method: merged[0]!.method, entries };
      }
      case "group": {
        if (node.key !== "entity") throw new Error("Passages cannot be ranked yet");
        const grouped = combine(node.input);
        if (grouped === null) return null;
        const input = entriesOf(grouped);
        const rankings = [{ representation: input.method, entries: input.entries }];
        return { unit: "entities", rankings, hits: fuseModes(rankings) };
      }
      case "fuse": {
        const fused = inputs(node.inputs);
        if (fused.length <= 1) return fused[0] ?? null;
        // The methods of one search fuse by their entries; anything else
        // as rankings of entities.
        if (fused.every((input) => input.unit === "entities" && input.rankings.length === 1)) {
          const rankings = fused.flatMap((input) => (input.unit === "entities" ? input.rankings : []));
          return { unit: "entities", rankings, hits: fuseModes(rankings) };
        }
        return { unit: "items", items: fuseItems(fused.map((input) => itemsOf(input, searches))) };
      }
      case "restrict":
        // Pushed into the search nodes.
        return combine(node.input);
      case "append": {
        const input = node.input === null ? null : combine(node.input);
        const items = input === null ? [] : itemsOf(input, searches);
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
        return { unit: "items", items };
      }
      case "cut": {
        const input = combine(node.input);
        if (input === null) return null;
        if (input.unit === "entries") throw new Error("A cut ranks entities");
        if (input.unit === "items") {
          counts.set(node, input.items.length);
          return { unit: "items", items: input.items.slice(0, node.limit) };
        }
        counts.set(node, input.hits.length);
        return { unit: "items", items: itemsOf({ ...input, hits: input.hits.slice(0, node.limit) }, searches) };
      }
      default:
        throw new Error(`A search tree with '${node.kind}' here cannot run`);
    }
  };
  return { root: combine(tree), counts };
}

function entriesOf(input: Combined): Extract<Combined, { unit: "entries" }> {
  if (input.unit !== "entries") throw new Error("Only entries merge and group yet");
  return input;
}

/** A ranking's entities with what found them: a fusion of methods hit by
 * hit, its search — the matched search node's sub-query and query text —
 * as their provenance. */
function itemsOf(input: Combined, searches: Planned[]): Item[] {
  if (input.unit === "items") return input.items;
  if (input.unit === "entries") throw new Error("Only grouped entities rank above a group");
  return input.hits.map((hit) => {
    const hitOf = toEngineHit(hit, searches, input.rankings);
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

function toEngineHit(hit: FusedHit<FoundEntry>, searches: Planned[], rankings: ModeRanking<FoundEntry>[]): EngineHit {
  const matchedSearch = searches[hit.matched.entry.search]!;
  // The entity's entries per method, the matched method first; per index
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
    entries: ranking.entries.filter((entry) => entry.entityId === hit.entityId),
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
  return {
    entityId: hit.entityId,
    entityType: matchedSearch.index.definition.entityType,
    score: hit.score,
    matched: { index: matchedSearch.index, entry: plain(hit.matched.entry) },
    indices,
  };
}
