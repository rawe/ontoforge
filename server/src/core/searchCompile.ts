/**
 * Compilers into the search tree (`searchTree.ts`): pure functions from a
 * search to the tree that answers it, in the tree's canonical shape —
 * search nodes → merge → group → fuse methods → fuse variants →
 * restrict / append → fuse sub-queries → cut, a layer with a single input
 * left out.
 */

import type { FilterCondition } from "./ports.js";
import type { FilterNode, MethodBlocks, SearchNode, TreeNode } from "./searchTree.js";

/** One index an entity search ranks, with what restricts it. */
export interface EntitySearchTarget {
  /** The index key. */
  index: string;
  /** The index's root entity type. */
  entityType: string;
  /** Exact conditions on the root type's entities — alike for every
   * target of one type. */
  conditions: FilterCondition[];
  /** Rank only these entities; null: every entity — alike for every target
   * of one type. */
  entityIds: readonly string[] | null;
  /** Relation types whose relation entries of this index count, on top of
   * the search's `relations`; null: no further restriction. */
  relations: readonly string[] | null;
}

export interface EntitySearch {
  text: string;
  /** At least one. */
  targets: EntitySearchTarget[];
  /** At least one block. */
  methods: MethodBlocks;
  /** Relation types whose relation entries count; null: all the lens shows. */
  relations: readonly string[] | null;
  limit: number;
  /** The plan's sub-query the search belongs to (planner compiler only). */
  subQuery?: number;
}

/**
 * The tree of an entity search: per method (semantic first), a search node
 * per target, merged by score and grouped by entity; two methods fused by
 * reciprocal rank — one keeps its scores; the targets' restrictions, per
 * entity type, as one restrict; cut to the limit.
 */
export function compileEntitySearch(search: EntitySearch): TreeNode {
  const groups: TreeNode[] = [];
  for (const method of ["semantic", "keyword"] as const) {
    const block = search.methods[method];
    if (block === undefined) continue;
    const searches = search.targets.map((target): SearchNode => {
      const common = {
        index: target.index,
        text: search.text,
        relations: relationsOf(search.relations, target.relations),
        ...(search.subQuery === undefined ? {} : { subQuery: search.subQuery }),
      };
      return method === "semantic"
        ? { kind: "semanticSearch", ...common, ...search.methods.semantic }
        : { kind: "keywordSearch", ...common, match: search.methods.keyword!.match };
    });
    groups.push({ kind: "group", key: "entity", input: single(searches, (inputs) => ({ kind: "merge", inputs })) });
  }
  const ranked = single(groups, (inputs) => ({ kind: "fuse", inputs }));
  const filters = restrictions(search.targets);
  return {
    kind: "cut",
    input: filters.length === 0 ? ranked : { kind: "restrict", input: ranked, filters },
    limit: search.limit,
  };
}

/** One sub-query of a retriever's plan, its restrictions resolved. */
export interface PlannedSubQuery {
  /** The query text and its variants; none: the restricted entities are
   * listed only. */
  texts: string[];
  /** The indices it searches. */
  targets: Pick<EntitySearchTarget, "index" | "entityType" | "relations">[];
  /** At least one block. */
  methods: MethodBlocks;
  /** The exact ids it is restricted to, per entity type, in the order
   * they were resolved; none: unrestricted. */
  restrictions: { entityType: string; ids: readonly string[] }[];
}

export interface PlannedSearch {
  subQueries: PlannedSubQuery[];
  /** The entities each query text ranks. */
  textLimit: number;
  /** A restricted sub-query's list: the restricted entities its search did
   * not rank follow while it holds fewer. */
  listLimit: number;
}

/**
 * The tree of a retriever's plan: per sub-query, each query text an entity
 * search cut to `textLimit`, the texts fused by reciprocal rank; with
 * restrictions, those as a restrict, and the restricted entities not
 * ranked appended until `listLimit` — a sub-query without a query text
 * only lists them. The sub-queries fused by reciprocal rank, uncut. Null
 * when no sub-query searches or lists anything.
 */
export function compilePlannedSearch(search: PlannedSearch): TreeNode | null {
  const subQueries = search.subQueries.flatMap((sub, subQuery): TreeNode[] => {
    const texts = sub.texts.map((text) =>
      compileEntitySearch({
        text,
        targets: sub.targets.map((target) => ({ ...target, conditions: [], entityIds: null })),
        methods: sub.methods,
        relations: null,
        limit: search.textLimit,
        subQuery,
      }),
    );
    const fused = texts.length === 0 ? null : single(texts, (inputs) => ({ kind: "fuse", inputs }));
    if (sub.restrictions.length === 0) return fused === null ? [] : [fused];
    const filters = sub.restrictions.map(
      (restriction): FilterNode => ({
        kind: "filter",
        entityType: restriction.entityType,
        conditions: [],
        ids: [...restriction.ids],
      }),
    );
    return [
      {
        kind: "append",
        input: fused === null ? null : { kind: "restrict", input: fused, filters },
        filters,
        until: search.listLimit,
        subQuery,
      },
    ];
  });
  return subQueries.length === 0 ? null : single(subQueries, (inputs) => ({ kind: "fuse", inputs }));
}

/** One input as itself, several combined. */
function single(inputs: TreeNode[], combine: (inputs: TreeNode[]) => TreeNode): TreeNode {
  if (inputs.length === 0) throw new Error("An entity search ranks at least one index by at least one method");
  return inputs.length === 1 ? inputs[0]! : combine(inputs);
}

/** The relation types whose entries of a target count: the search's,
 * narrowed by the target's own. */
function relationsOf(search: readonly string[] | null, own: readonly string[] | null): string[] | null {
  if (own === null) return search === null ? null : [...search];
  return search === null ? [...own] : own.filter((key) => search.includes(key));
}

/** One filter per restricted entity type, in target order. */
function restrictions(targets: EntitySearchTarget[]): FilterNode[] {
  const byType = new Map<string, EntitySearchTarget>();
  for (const target of targets) {
    const prior = byType.get(target.entityType);
    if (prior === undefined) {
      byType.set(target.entityType, target);
    } else if (
      JSON.stringify([prior.conditions, prior.entityIds]) !== JSON.stringify([target.conditions, target.entityIds])
    ) {
      throw new Error(`The targets of entity type '${target.entityType}' restrict it differently`);
    }
  }
  return [...byType.values()]
    .filter((target) => target.conditions.length > 0 || target.entityIds !== null)
    .map((target) => ({
      kind: "filter",
      entityType: target.entityType,
      conditions: [...target.conditions],
      ids: target.entityIds === null ? null : [...target.entityIds],
    }));
}
