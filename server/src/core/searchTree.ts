/**
 * The search tree: what a search means, as plain data — no functions — so
 * a tree can be checked apart from running it, printed, and later stored.
 * Every search compiles into one (`searchCompile.ts`); the executor
 * (`runtime/search/executor.ts`) runs it.
 *
 * Leaves rank one index by one method for one text (`rank`) or name an
 * exact set of entities (`select`); inner nodes combine what flows up.
 * Each node yields a value: a ranking of entries, entities or passages on
 * a scale — where the numbers of its order came from — or a set. The
 * rules (`validateSearchTree`, R1–R8) refuse a tree whose values do not
 * fit, every violation at its path.
 *
 * Pure — no storage, no I/O.
 */

import type { FilterCondition, KeywordMatching } from "./ports.js";
import type { SearchRepresentation } from "./searchIndex.js";

// ---------------------------------------------------------------------------
// Method blocks
// ---------------------------------------------------------------------------

/** The keyword method's options: whether an entry needs any of the query's
 * words or all of them. */
export interface KeywordBlock {
  match: KeywordMatching;
}

/** The semantic method's options: the floor on an entry's similarity,
 * `(1 + cosine) / 2`, 0..1; absent: none. */
export interface SemanticBlock {
  minSimilarity?: number;
}

/** The methods a search runs, one block each — the blocks present choose
 * them; both: hybrid. */
export interface MethodBlocks {
  keyword?: KeywordBlock;
  semantic?: SemanticBlock;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/** Rank one index's entries by one method for one text — the only node
 * that searches. Its one block names the method. */
export interface RankNode {
  kind: "rank";
  /** The index key. */
  index: string;
  text: string;
  keyword?: KeywordBlock;
  semantic?: SemanticBlock;
  /** Relation types whose relation entries count; null: every one the
   * lens shows. */
  relations: string[] | null;
}

/** The entities of one type that meet exact conditions on stored values
 * and, unless `ids` is null, are among the ids — a set, no order. */
export interface SelectNode {
  kind: "select";
  entityType: string;
  conditions: FilterCondition[];
  ids: string[] | null;
}

/** The entities in every input set. */
export interface IntersectNode {
  kind: "intersect";
  inputs: SearchNode[];
}

/** Rankings of one scale as one, by score. */
export interface MergeNode {
  kind: "merge";
  inputs: SearchNode[];
}

/** Entries to one item per result unit — an entity, or a passage — kept
 * by its best entry. */
export interface GroupNode {
  kind: "group";
  key: "entity" | "passage";
  input: SearchNode;
}

/** Rankings of one unit as one by reciprocal rank — their order only. */
export interface FuseNode {
  kind: "fuse";
  inputs: SearchNode[];
}

/** The ranking's items whose entity is in the set of its type — one set
 * per entity type; items of other types are kept. */
export interface RestrictNode {
  kind: "restrict";
  input: SearchNode;
  sets: SearchNode[];
}

/** The ranking, then the set's entities it did not rank. */
export interface AppendNode {
  kind: "append";
  input: SearchNode;
  set: SearchNode;
}

/** The ranking's first `limit` items — the root. */
export interface CutNode {
  kind: "cut";
  input: SearchNode;
  limit: number;
}

export type SearchNode =
  | RankNode
  | SelectNode
  | IntersectNode
  | MergeNode
  | GroupNode
  | FuseNode
  | RestrictNode
  | AppendNode
  | CutNode;

/** The method a rank ranks by: its one block's — null with none or both. */
export function rankMethod(node: RankNode): SearchRepresentation | null {
  if (node.keyword !== undefined && node.semantic === undefined) return "keyword";
  if (node.semantic !== undefined && node.keyword === undefined) return "semantic";
  return null;
}

/** A node's inputs, each with its path segment. */
function inputsOf(node: SearchNode): [string, SearchNode][] {
  switch (node.kind) {
    case "intersect":
    case "merge":
    case "fuse":
      return node.inputs.map((input, i) => [`inputs.${i}`, input]);
    case "group":
    case "cut":
      return [["input", node.input]];
    case "restrict":
      return [["input", node.input], ...node.sets.map((set, i): [string, SearchNode] => [`sets.${i}`, set])];
    case "append":
      return [
        ["input", node.input],
        ["set", node.set],
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** Where a ranking's order came from. Two rankings merge by score only on
 * one scale: similarities to one text's embedding by one model, keyword
 * scores of one text and matching — in the ontology's one language
 * setting. `ordinal`: the order only. */
export type SearchScale =
  | { kind: "semantic"; model: string | null; text: string }
  | { kind: "keyword"; text: string; match: KeywordMatching }
  | { kind: "ordinal" };

/** What a node yields: a ranking of entries, entities or passages on a
 * scale, or a set of entities of one type. */
export type SearchValue =
  | { unit: "entries" | "entities" | "passages"; scale: SearchScale }
  | { unit: "set"; entityType: string };

/** What a tree is checked against: the lens and the ranking environment. */
export interface SearchTreeContext {
  /** The indices the lens may search, by key. */
  indices: ReadonlySet<string>;
  /** The entity types the lens exposes. */
  entityTypes: ReadonlySet<string>;
  /** The embedding model semantic leaves rank by; null without one. */
  model: string | null;
}

/** The value a node yields — null when the tree below does not fit the
 * rules (`validateSearchTree` says why). */
export function searchValue(node: SearchNode, context: SearchTreeContext): SearchValue | null {
  return typeOf(node, "", context, []);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** The rule a tree breaks: R1–R8, or `shape` — a node's own parameters. */
export type SearchTreeRule = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "shape";

export interface SearchTreeViolation {
  rule: SearchTreeRule;
  /** Dotted path from the root (`""`) through `input`, `inputs.<i>`,
   * `sets.<i>` and `set`. */
  path: string;
  message: string;
}

/**
 * Check a tree against the rules, reporting every violation:
 *
 * - R1 a merge's rankings share one scale;
 * - R2 every rank reaches the root through exactly one group, below every
 *   fuse;
 * - R3 an ordinal ranking is only fused, restricted, appended to or cut;
 * - R4 a fuse or merge combines one unit; append ranks entities;
 * - R5 a floor lives in a semantic leaf;
 * - R6 a set enters a ranking only through restrict or append;
 * - R7 leaves name what the lens shows: a searchable index, an exposed type;
 * - R8 the root, and only the root, is a cut of entities or passages.
 */
export function validateSearchTree(tree: SearchNode, context: SearchTreeContext): SearchTreeViolation[] {
  const violations: SearchTreeViolation[] = [];
  typeOf(tree, "", context, violations);
  if (tree.kind !== "cut") violations.push({ rule: "R8", path: "", message: "The root of a tree is a cut" });
  return violations;
}

type Ranking = Extract<SearchValue, { scale: SearchScale }>;

function sameScale(a: SearchScale, b: SearchScale): boolean {
  if (a.kind === "semantic" && b.kind === "semantic") return a.model === b.model && a.text === b.text;
  if (a.kind === "keyword" && b.kind === "keyword") {
    return a.text === b.text && a.match === b.match;
  }
  return a.kind === b.kind;
}

/** The value of a node, its inputs checked first; null when it, or an
 * input it depends on, breaks a rule — a node above does not report again
 * what follows from that. */
function typeOf(
  node: SearchNode,
  path: string,
  context: SearchTreeContext,
  violations: SearchTreeViolation[],
): SearchValue | null {
  const refuse = (rule: SearchTreeRule, message: string, at = path): null => {
    violations.push({ rule, path: at, message });
    return null;
  };
  const inputs = inputsOf(node).map(([segment, input]) => {
    const at = path === "" ? segment : `${path}.${segment}`;
    return { path: at, value: typeOf(input, at, context, violations) };
  });
  // The inputs that must be rankings: a set refused (R6), an ordinal one
  // too where only a scored ranking fits (R3). Null when one does not fit.
  const rankings = (of: typeof inputs, scored: boolean): Ranking[] | null => {
    if (of.some((input) => input.value === null)) return null;
    const misfits = of.filter((input) => {
      if (input.value!.unit === "set") {
        refuse("R6", "A set enters a ranking only through restrict or append", input.path);
        return true;
      }
      if (scored && input.value!.scale.kind === "ordinal") {
        refuse("R3", "An ordinal ranking is only fused, restricted, appended to or cut", input.path);
        return true;
      }
      return false;
    });
    return misfits.length > 0 ? null : (of.map((input) => input.value) as Ranking[]);
  };

  switch (node.kind) {
    case "rank": {
      if (!context.indices.has(node.index)) refuse("R7", `Search index '${node.index}' is not searchable in this lens`);
      if (node.keyword !== undefined && "minSimilarity" in node.keyword) {
        return refuse("R5", "A floor lives in a semantic leaf; keyword scores have none");
      }
      const method = rankMethod(node);
      if (method === null) return refuse("shape", "A rank ranks by one method: one block, keyword or semantic");
      if (node.text.trim() === "") return refuse("shape", "A rank needs a query text");
      if (method === "keyword") {
        return { unit: "entries", scale: { kind: "keyword", text: node.text, match: node.keyword!.match } };
      }
      const floor = node.semantic!.minSimilarity;
      if (floor !== undefined && !(floor >= 0 && floor <= 1)) {
        return refuse("shape", "minSimilarity is a number from 0 to 1");
      }
      return { unit: "entries", scale: { kind: "semantic", model: context.model, text: node.text } };
    }
    case "select":
      if (!context.entityTypes.has(node.entityType)) {
        refuse("R7", `Entity type '${node.entityType}' is not in this lens`);
      }
      return { unit: "set", entityType: node.entityType };
    case "intersect": {
      if (inputs.length === 0) return refuse("shape", "An intersect needs at least one set");
      if (inputs.some((input) => input.value === null)) return null;
      const ranked = inputs.filter((input) => input.value!.unit !== "set");
      for (const input of ranked) refuse("R6", "Only sets intersect", input.path);
      if (ranked.length > 0) return null;
      const types = new Set(inputs.map((input) => (input.value as { entityType: string }).entityType));
      if (types.size > 1) return refuse("shape", "An intersect's sets are of one entity type");
      return { unit: "set", entityType: [...types][0]! };
    }
    case "merge": {
      if (inputs.length === 0) return refuse("shape", "A merge needs at least one ranking");
      const merged = rankings(inputs, true);
      if (merged === null) return null;
      if (merged.some((value) => value.unit !== merged[0]!.unit)) {
        return refuse("R4", "A merge combines rankings of one unit");
      }
      if (merged.some((value) => !sameScale(value.scale, merged[0]!.scale))) {
        return refuse("R1", "A merge combines rankings of one scale: one method, text and model; else fuse them");
      }
      return merged[0]!;
    }
    case "group": {
      const [input] = rankings(inputs, true) ?? [];
      if (input === undefined) return null;
      if (input.unit !== "entries") {
        return refuse("R2", "A rank reaches the root through exactly one group; this one groups grouped items");
      }
      return { unit: node.key === "entity" ? "entities" : "passages", scale: input.scale };
    }
    case "fuse": {
      if (inputs.length === 0) return refuse("shape", "A fuse needs at least one ranking");
      const fused = rankings(inputs, false);
      if (fused === null) return null;
      if (fused.some((value) => value.unit === "entries")) {
        return refuse("R2", "A fuse combines grouped rankings: a group below every fuse, so an item votes once");
      }
      if (fused.some((value) => value.unit !== fused[0]!.unit)) {
        return refuse("R4", "A fuse combines rankings of one unit");
      }
      return { unit: fused[0]!.unit, scale: { kind: "ordinal" } };
    }
    case "restrict": {
      const [input, ...sets] = inputs;
      if (sets.length === 0) refuse("shape", "A restrict needs at least one set");
      const types = new Set<string>();
      for (const set of sets) {
        if (set.value === null) continue;
        if (set.value.unit !== "set") {
          refuse("R6", "A restrict keeps the items in a set; this is a ranking", set.path);
        } else if (types.has(set.value.entityType)) {
          refuse("shape", `A restrict has one set per entity type; '${set.value.entityType}' has two`, set.path);
        } else {
          types.add(set.value.entityType);
        }
      }
      return rankings([input!], false)?.[0] ?? null;
    }
    case "append": {
      const [input, set] = inputs;
      if (set!.value !== null && set!.value.unit !== "set") {
        refuse("R6", "An append adds the entities of a set; this is a ranking", set!.path);
      }
      const [ranking] = rankings([input!], false) ?? [];
      if (ranking === undefined) return null;
      if (ranking.unit === "entries") {
        return refuse("R2", "An append adds to grouped entities; group the entries first");
      }
      if (ranking.unit !== "entities") return refuse("R4", "An append adds to a ranking of entities");
      return { unit: "entities", scale: { kind: "ordinal" } };
    }
    case "cut": {
      if (path !== "") refuse("R8", "A cut is the root of a tree");
      if (!Number.isInteger(node.limit) || node.limit < 1 || node.limit > 100) {
        refuse("shape", "A cut's limit is an integer from 1 to 100");
      }
      const [input] = rankings(inputs, false) ?? [];
      if (input === undefined) return null;
      if (input.unit === "entries") {
        return refuse("R2", "A rank reaches the root through exactly one group; these entries are not grouped");
      }
      return input;
    }
    default:
      return refuse("shape", `Unknown node kind '${(node as { kind: unknown }).kind}'`);
  }
}

// ---------------------------------------------------------------------------
// Canonical printout
// ---------------------------------------------------------------------------

/**
 * A tree as text, one node per line under its parent, inputs in order —
 * the same tree always prints the same: parameters in canonical JSON (keys
 * sorted), the ids and relation types of a leaf sorted.
 */
export function printSearchTree(tree: SearchNode): string {
  const lines: string[] = [];
  const print = (node: SearchNode, lead: string, indent: string) => {
    lines.push(lead + label(node));
    const inputs = inputsOf(node);
    inputs.forEach(([, input], i) => {
      const last = i === inputs.length - 1;
      print(input, indent + (last ? "└─ " : "├─ "), indent + (last ? "   " : "│  "));
    });
  };
  print(tree, "", "");
  return lines.join("\n");
}

function label(node: SearchNode): string {
  switch (node.kind) {
    case "rank":
      return `rank(${[
        node.index,
        ...(["semantic", "keyword"] as const).flatMap((method) =>
          node[method] === undefined ? [] : [`${method} ${canonical(node[method])}`],
        ),
        JSON.stringify(node.text),
        ...(node.relations === null ? [] : [`relations ${canonical([...node.relations].sort())}`]),
      ].join(", ")})`;
    case "select":
      return `select(${[
        node.entityType,
        ...(node.conditions.length === 0 ? [] : [`where ${canonical(node.conditions)}`]),
        ...(node.ids === null ? [] : [`ids ${canonical([...node.ids].sort())}`]),
      ].join(", ")})`;
    case "group":
      return `group(${node.key})`;
    case "cut":
      return `cut(limit ${node.limit})`;
    default:
      return node.kind;
  }
}

/** JSON with every object's keys sorted. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const fields = Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${fields.map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
