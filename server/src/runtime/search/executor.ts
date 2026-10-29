/**
 * Run a search tree (`core/searchTree.ts`) over the indices' active
 * generations:
 *
 * 1. Each `rank` gets the ready generation of its index in its method —
 *    semantic only of the embedding model in use — and every restriction
 *    above it, pushed into its own ranking: the exact conditions and the
 *    ids of its root type, with the lens's hidden relation and target
 *    types. A leaf without a ready generation, or whose index does not
 *    enable its method, contributes nothing; a layer left with a single
 *    input passes it on — a hybrid search with one method to run keeps
 *    that method's scores.
 * 2. Each semantic text is embedded once; the leaves rank in parallel,
 *    first `limit × 4` entries each. A semantic floor drops the entries
 *    below it after the fetch.
 * 3. Bottom-up (`core/searchQuery.ts`): merge by raw score, group by
 *    entity — the best entry scores it — and fuse by reciprocal rank. If
 *    fewer than `limit` entities come out, the leaves not yet exhausted
 *    fetch once more, up to a fixed cap — never more — and the tree is
 *    combined again.
 * 4. Cut to `limit`; each hit carries what found it, per index.
 *
 * It runs the trees the compilers build today; append, passage results
 * and nested fusion come with the searches that need them.
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
import { fuseModes, mergeByScore, type FusedHit, type ModeRanking } from "../../core/searchQuery.js";
import { rankMethod, type CutNode, type RankNode, type SearchNode } from "../../core/searchTree.js";
import type { LoadedSchema } from "../schemaCache.js";
import type { EngineHit, IndexMatch } from "./indexSearch.js";

/** Entries a leaf first fetches per requested entity. */
const OVERFETCH_FACTOR = 4;

/** The most entries one leaf fetches. */
const ENTRY_FETCH_CAP = 1000;

/** What restricts the entities of one type: exact conditions, and the
 * ids they must be among (null: any). */
interface Restriction {
  conditions: FilterCondition[];
  ids: readonly string[] | null;
}

interface Leaf {
  node: RankNode;
  index: SearchIndexRecord;
  method: SearchRepresentation;
  /** Absent: the leaf cannot run. */
  generation: SearchGenerationRecord | undefined;
  restriction: Restriction | undefined;
}

interface FetchedLeaf {
  entries: RankedSearchEntry[];
  /** Fetching more would add nothing: the ranking ran out (or past the
   * floor). */
  exhausted: boolean;
}

/** An entry with the leaf it came from. */
type LeafEntry = RankedSearchEntry & { leaf: number };

/** A node's ranking: the entries of one method, or entities with the
 * method rankings they come from. */
type Combined =
  | { unit: "entries"; method: SearchRepresentation; entries: LeafEntry[] }
  | { unit: "entities"; rankings: ModeRanking<LeafEntry>[]; hits: FusedHit<LeafEntry>[] };

/** Run a valid tree; `indices` holds every index its leaves name. */
export async function executeSearchTree(
  loaded: LoadedSchema,
  indexStore: SearchIndexStore,
  indices: ReadonlyMap<string, SearchIndexRecord>,
  tree: SearchNode,
): Promise<EngineHit[]> {
  if (tree.kind !== "cut") throw new Error("The root of a search tree is a cut");
  const provider = getEmbeddingProvider();
  const ready = (await indexStore.listGenerations()).filter((g) => g.state === "ready");
  const leaves = planLeaves(tree, indices, ready, provider?.modelId);
  if (leaves.every((leaf) => leaf.generation === undefined)) return [];

  const vectors = new Map<string, number[]>();
  for (const leaf of leaves) {
    if (leaf.generation === undefined || leaf.method !== "semantic" || vectors.has(leaf.node.text)) continue;
    const embedded = await provider!.embed(leaf.node.text);
    if (!embedded) throw new ValidationError("Failed to generate embedding for search query");
    vectors.set(leaf.node.text, embedded);
  }

  // The lens's hidden relation and target types.
  const scoped = loaded.searchIndexScope.scoped;
  const lensRelations = scoped ? Object.keys(loaded.scoped.relationTypes) : null;
  const targetTypes = scoped ? Object.keys(loaded.scoped.entityTypes) : null;

  const fetchLeaf = async (leaf: Leaf, limit: number): Promise<FetchedLeaf> => {
    const semantic = leaf.method === "semantic";
    const own = leaf.node.relations;
    const raw = await indexStore.rankEntries({
      generationId: leaf.generation!.generationId,
      ...(semantic
        ? { vector: vectors.get(leaf.node.text) }
        : { text: leaf.node.text, matching: leaf.node.keyword!.match }),
      conditions: leaf.restriction?.conditions ?? [],
      entityIds: leaf.restriction?.ids ?? null,
      relationTypes:
        own === null ? lensRelations : own.filter((key) => lensRelations === null || lensRelations.includes(key)),
      targetTypes,
      limit,
    });
    const floor = semantic ? (leaf.node.semantic!.minSimilarity ?? null) : null;
    const entries = floor === null ? raw : raw.filter((entry) => entry.score >= floor);
    const exhausted = raw.length < limit || (floor !== null && raw.at(-1)!.score < floor);
    return { entries, exhausted };
  };

  const fetchAll = (limit: number, prior?: (FetchedLeaf | null)[]) =>
    Promise.all(
      leaves.map((leaf, i) =>
        leaf.generation === undefined ? null : prior?.[i]?.exhausted ? prior[i]! : fetchLeaf(leaf, limit),
      ),
    );
  const first = Math.min(tree.limit * OVERFETCH_FACTOR, ENTRY_FETCH_CAP);
  let fetched = await fetchAll(first);
  let root = rootOf(tree, leaves, fetched);
  if (root.hits.length < tree.limit && first < ENTRY_FETCH_CAP && fetched.some((f) => f !== null && !f.exhausted)) {
    fetched = await fetchAll(ENTRY_FETCH_CAP, fetched);
    root = rootOf(tree, leaves, fetched);
  }
  return root.hits.slice(0, tree.limit).map((hit) => toEngineHit(hit, leaves, root.rankings));
}

/** The rank leaves in tree order, each with its generation and the
 * restrictions pushed down to it. */
function planLeaves(
  tree: SearchNode,
  indices: ReadonlyMap<string, SearchIndexRecord>,
  ready: SearchGenerationRecord[],
  modelId: string | undefined,
): Leaf[] {
  const leaves: Leaf[] = [];
  const plan = (node: SearchNode, restrictions: ReadonlyMap<string, Restriction>): void => {
    switch (node.kind) {
      case "rank": {
        const index = indices.get(node.index)!;
        const method = rankMethod(node)!;
        const generation = index.definition[method].enabled
          ? ready.find(
              (g) =>
                g.searchIndexId === index.searchIndexId &&
                g.representation === method &&
                (method === "keyword" || g.modelId === modelId),
            )
          : undefined;
        leaves.push({ node, index, method, generation, restriction: restrictions.get(index.definition.entityType) });
        return;
      }
      case "restrict": {
        const narrowed = new Map(restrictions);
        for (const set of node.sets) {
          const { entityType, restriction } = restrictionOf(set);
          narrowed.set(entityType, both(narrowed.get(entityType), restriction));
        }
        plan(node.input, narrowed);
        return;
      }
      case "merge":
      case "fuse":
        for (const input of node.inputs) plan(input, restrictions);
        return;
      case "group":
      case "cut":
        plan(node.input, restrictions);
        return;
      default:
        throw new Error(`A search tree with '${node.kind}' cannot run yet`);
    }
  };
  plan(tree, new Map());
  return leaves;
}

/** A set as the restriction of its entity type. */
function restrictionOf(set: SearchNode): { entityType: string; restriction: Restriction } {
  if (set.kind === "select") {
    return { entityType: set.entityType, restriction: { conditions: set.conditions, ids: set.ids } };
  }
  if (set.kind === "intersect") {
    const parts = set.inputs.map(restrictionOf);
    return {
      entityType: parts[0]!.entityType,
      restriction: parts.map((part) => part.restriction).reduce((a, b) => both(a, b)),
    };
  }
  throw new Error(`'${set.kind}' is not a set`);
}

/** Both restrictions at once: every condition, the ids in both. */
function both(a: Restriction | undefined, b: Restriction): Restriction {
  if (a === undefined) return b;
  return {
    conditions: [...a.conditions, ...b.conditions],
    ids: a.ids === null ? b.ids : b.ids === null ? a.ids : a.ids.filter((id) => b.ids!.includes(id)),
  };
}

/** The root's entity ranking, before its cut. */
function rootOf(tree: CutNode, leaves: Leaf[], fetched: (FetchedLeaf | null)[]) {
  const leafOf = new Map(leaves.map((leaf, i) => [leaf.node as SearchNode, i] as const));
  const root = combine(tree.input, leafOf, fetched);
  if (root?.unit !== "entities") throw new Error("A search tree's cut ranks entities");
  return root;
}

/** A node's ranking, bottom-up; null when no leaf below it runs. */
function combine(
  node: SearchNode,
  leafOf: ReadonlyMap<SearchNode, number>,
  fetched: (FetchedLeaf | null)[],
): Combined | null {
  const inputs = (nodes: SearchNode[]) =>
    nodes.map((input) => combine(input, leafOf, fetched)).filter((input): input is Combined => input !== null);
  switch (node.kind) {
    case "rank": {
      const leaf = leafOf.get(node)!;
      const own = fetched[leaf]!;
      if (own === null) return null;
      // Best first, as the port ranks them; equal scores keep their order.
      const entries = mergeByScore([own.entries.map((entry) => ({ ...entry, leaf }))]);
      return { unit: "entries", method: rankMethod(node)!, entries };
    }
    case "merge": {
      const merged = inputs(node.inputs).map(entriesOf);
      if (merged.length === 0) return null;
      const entries = mergeByScore(merged.map((input) => input.entries));
      return { unit: "entries", method: merged[0]!.method, entries };
    }
    case "group": {
      if (node.key !== "entity") throw new Error("Passages cannot be ranked yet");
      const grouped = combine(node.input, leafOf, fetched);
      if (grouped === null) return null;
      const input = entriesOf(grouped);
      const rankings = [{ representation: input.method, entries: input.entries }];
      return { unit: "entities", rankings, hits: fuseModes(rankings) };
    }
    case "fuse": {
      const fused = inputs(node.inputs);
      if (fused.length <= 1) return fused[0] ?? null;
      const rankings = fused.flatMap((input) => {
        if (input.unit !== "entities" || input.rankings.length !== 1) throw new Error("Only grouped rankings fuse yet");
        return input.rankings;
      });
      return { unit: "entities", rankings, hits: fuseModes(rankings) };
    }
    case "restrict":
      // Pushed into the leaves.
      return combine(node.input, leafOf, fetched);
    default:
      throw new Error(`A search tree with '${node.kind}' here cannot run yet`);
  }
}

function entriesOf(input: Combined): Extract<Combined, { unit: "entries" }> {
  if (input.unit !== "entries") throw new Error("Only entries merge and group yet");
  return input;
}

/** Same entry: same part of the same entity. */
function sameEntry(a: RankedSearchEntry, b: RankedSearchEntry): boolean {
  return a.partKind === b.partKind && a.groupNo === b.groupNo && a.partId === b.partId;
}

/** Without the ranking bookkeeping. */
function plain({ leaf: _leaf, ...entry }: LeafEntry): RankedSearchEntry {
  return entry;
}

function toEngineHit(hit: FusedHit<LeafEntry>, leaves: Leaf[], rankings: ModeRanking<LeafEntry>[]): EngineHit {
  const matchedLeaf = leaves[hit.matched.entry.leaf]!;
  // The entity's entries per method, the matched method first; per index
  // the first of them — the best of the method it ranks best in —
  // represents it, and is measured wherever a leaf fetched that very entry.
  const ordered = [...rankings].sort(
    (a, b) =>
      Number(b.representation === hit.matched.representation) -
      Number(a.representation === hit.matched.representation),
  );
  const own = ordered.map((ranking) => ({
    representation: ranking.representation,
    entries: ranking.entries.filter((entry) => entry.entityId === hit.entityId),
  }));
  const primaries = new Map<string, LeafEntry>();
  for (const { entries } of own) {
    for (const entry of entries) {
      const key = leaves[entry.leaf]!.index.key;
      if (!primaries.has(key)) primaries.set(key, entry);
    }
  }
  const indices: IndexMatch[] = [...primaries].map(([key, primary]) => {
    const measured = (representation: SearchRepresentation) =>
      own
        .find((method) => method.representation === representation)
        ?.entries.find((entry) => leaves[entry.leaf]!.index.key === key && sameEntry(entry, primary))?.score ?? null;
    return {
      index: leaves[primary.leaf]!.index,
      entry: plain(primary),
      semanticSimilarity: measured("semantic"),
      keywordScore: measured("keyword"),
    };
  });
  return {
    entityId: hit.entityId,
    entityType: matchedLeaf.index.definition.entityType,
    score: hit.score,
    matched: { index: matchedLeaf.index, entry: plain(hit.matched.entry) },
    indices,
  };
}
