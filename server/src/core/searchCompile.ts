/**
 * Compilers into the search tree (`searchTree.ts`): pure functions from a
 * search to the tree that answers it, in the tree's canonical shape — rank
 * → merge → group → fuse → restrict → cut, a layer with a single input
 * left out.
 */

import type { FilterCondition } from "./ports.js";
import type { MethodBlocks, SearchNode } from "./searchTree.js";

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
}

/**
 * The tree of an entity search: per method (semantic first), a rank per
 * target, merged by score and grouped by entity; two methods fused by
 * reciprocal rank — one keeps its scores; the targets' restrictions, per
 * entity type, as one restrict; cut to the limit.
 */
export function compileEntitySearch(search: EntitySearch): SearchNode {
  const groups: SearchNode[] = [];
  for (const method of ["semantic", "keyword"] as const) {
    const block = search.methods[method];
    if (block === undefined) continue;
    const ranks = search.targets.map(
      (target): SearchNode => ({
        kind: "rank",
        index: target.index,
        text: search.text,
        ...(method === "semantic"
          ? { semantic: { ...search.methods.semantic } }
          : { keyword: { ...search.methods.keyword! } }),
        relations: relationsOf(search.relations, target.relations),
      }),
    );
    groups.push({ kind: "group", key: "entity", input: single(ranks, (inputs) => ({ kind: "merge", inputs })) });
  }
  const ranked = single(groups, (inputs) => ({ kind: "fuse", inputs }));
  const sets = restrictions(search.targets);
  return {
    kind: "cut",
    input: sets.length === 0 ? ranked : { kind: "restrict", input: ranked, sets },
    limit: search.limit,
  };
}

/** One input as itself, several combined. */
function single(inputs: SearchNode[], combine: (inputs: SearchNode[]) => SearchNode): SearchNode {
  if (inputs.length === 0) throw new Error("An entity search ranks at least one index by at least one method");
  return inputs.length === 1 ? inputs[0]! : combine(inputs);
}

/** The relation types whose entries of a target count: the search's,
 * narrowed by the target's own. */
function relationsOf(search: readonly string[] | null, own: readonly string[] | null): string[] | null {
  if (own === null) return search === null ? null : [...search];
  return search === null ? [...own] : own.filter((key) => search.includes(key));
}

/** One set per restricted entity type, in target order. */
function restrictions(targets: EntitySearchTarget[]): SearchNode[] {
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
      kind: "select",
      entityType: target.entityType,
      conditions: [...target.conditions],
      ids: target.entityIds === null ? null : [...target.entityIds],
    }));
}
