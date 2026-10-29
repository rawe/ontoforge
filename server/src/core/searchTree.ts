/**
 * The search tree: what a search means, as plain data — no functions — so
 * a tree can be checked apart from running it, printed, and later stored.
 * Every search compiles into one (`searchCompile.ts`); the executor
 * (`runtime/search/executor.ts`) runs it.
 *
 * Search nodes search one index by one method for one query text
 * (`keywordSearch`, `semanticSearch`); a `filter` names the exact ids of
 * the entities of one type that satisfy it; the other nodes combine what
 * flows up. Each node yields a value: a ranking of entries, entities or
 * passages with its score kind — what the numbers of its order mean — or
 * entity ids. The rules (`validateSearchTree`, R1–R8) refuse a tree whose
 * values do not fit, every violation at its path.
 *
 * Pure — no storage, no I/O.
 */

import type { FilterCondition, KeywordMatching, SearchPartKind } from "./ports.js";
import type { SearchRepresentation } from "./searchIndex.js";

// ---------------------------------------------------------------------------
// Method blocks
// ---------------------------------------------------------------------------

/** The keyword method's options: whether an entry needs any of the query's
 * words or all of them. Configures every `keywordSearch` node. */
export interface KeywordBlock {
  match: KeywordMatching;
}

/** The semantic method's options: the floor on an entry's similarity,
 * `(1 + cosine) / 2`, 0..1; absent: none. Configures every
 * `semanticSearch` node. */
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

/** Search one index by keyword for one query text: its entries in keyword
 * score order. */
export interface KeywordSearchNode {
  kind: "keywordSearch";
  /** The index key. */
  index: string;
  text: string;
  match: KeywordMatching;
  /** Relation types whose relation entries count; null: every one the
   * lens shows. */
  relations: string[] | null;
  /** The entry parts that count; absent: every part. */
  parts?: SearchPartKind[];
  /** The plan's sub-query the search belongs to — set by the planner
   * compiler only, carried into provenance. */
  subQuery?: number;
}

/** Search one index by semantic similarity to one query text. */
export interface SemanticSearchNode {
  kind: "semanticSearch";
  /** The index key. */
  index: string;
  text: string;
  /** Entries below it do not count; absent: none. */
  minSimilarity?: number;
  /** As a keyword search's. */
  relations: string[] | null;
  parts?: SearchPartKind[];
  subQuery?: number;
}

/** A search node: the only nodes that search. */
export type SearchNode = KeywordSearchNode | SemanticSearchNode;

/** The ids of the entities of one type that meet exact conditions on
 * stored values and, unless `ids` is null, are among the ids — no order,
 * no scores. */
export interface FilterNode {
  kind: "filter";
  entityType: string;
  conditions: FilterCondition[];
  ids: string[] | null;
}

/** Rankings of one score kind as one, by score. */
export interface MergeNode {
  kind: "merge";
  inputs: TreeNode[];
}

/** Entries to one item per result unit — an entity, or a passage — kept
 * by its best entry. */
export interface GroupNode {
  kind: "group";
  key: "entity" | "passage";
  input: TreeNode;
}

/** Rankings of one result unit as one by reciprocal rank — their order
 * only. */
export interface FuseNode {
  kind: "fuse";
  inputs: TreeNode[];
}

/** The ranking's items whose entity is in the filter of its type — one
 * filter per entity type; items of other types are kept. */
export interface RestrictNode {
  kind: "restrict";
  input: TreeNode;
  filters: TreeNode[];
}

/** The ranking (none: an empty one), then the filters' entities it did
 * not rank — filter by filter, each in id order — while it holds fewer
 * than `until` items; a ranking that long already is kept whole. */
export interface AppendNode {
  kind: "append";
  input: TreeNode | null;
  /** One per entity type. */
  filters: TreeNode[];
  until: number;
  /** As a search node's. */
  subQuery?: number;
}

/** The ranking's first `limit` items — of passages at most `perEntity`
 * per entity, in rank order. */
export interface CutNode {
  kind: "cut";
  input: TreeNode;
  limit: number;
  /** Passages only, 1..limit; absent: no cap. */
  perEntity?: number;
}

export type TreeNode =
  | KeywordSearchNode
  | SemanticSearchNode
  | FilterNode
  | MergeNode
  | GroupNode
  | FuseNode
  | RestrictNode
  | AppendNode
  | CutNode;

/** Whether a node searches. */
export function isSearchNode(node: TreeNode): node is SearchNode {
  return node.kind === "keywordSearch" || node.kind === "semanticSearch";
}

/** The method a search node searches by — its kind. */
export function searchMethod(node: SearchNode): SearchRepresentation {
  return node.kind === "keywordSearch" ? "keyword" : "semantic";
}

/** A node's inputs, each with its path segment. */
function inputsOf(node: TreeNode): [string, TreeNode][] {
  const filters = (of: TreeNode[]) => of.map((filter, i): [string, TreeNode] => [`filters.${i}`, filter]);
  switch (node.kind) {
    case "merge":
    case "fuse":
      return node.inputs.map((input, i) => [`inputs.${i}`, input]);
    case "group":
    case "cut":
      return [["input", node.input]];
    case "restrict":
      return [["input", node.input], ...filters(node.filters)];
    case "append":
      return [...(node.input === null ? [] : [["input", node.input] as [string, TreeNode]]), ...filters(node.filters)];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** What a ranking's scores mean. Two rankings merge by score only with one
 * score kind: semantic similarities to one query text by one model,
 * keyword scores of one query text and match — in the ontology's one
 * language setting. `rankOnly`: the order only. */
export type ScoreKind =
  | { kind: "semanticSimilarity"; model: string | null; text: string }
  | { kind: "keywordScore"; text: string; match: KeywordMatching }
  | { kind: "rankOnly" };

/** What a node yields: a ranking of entries, entities or passages with its
 * score kind, or the entity ids of one type. */
export type TreeValue =
  | { unit: "entries" | "entities" | "passages"; scoreKind: ScoreKind }
  | { unit: "entityIds"; entityType: string };

/** What a tree is checked against: the lens and the ranking environment. */
export interface SearchTreeContext {
  /** The indices the lens may search, by key. */
  indices: ReadonlySet<string>;
  /** The entity types the lens exposes. */
  entityTypes: ReadonlySet<string>;
  /** The embedding model semantic searches rank by; null without one. */
  model: string | null;
}

/** The value a node yields — null when the tree below does not fit the
 * rules (`validateSearchTree` says why). */
export function treeValue(node: TreeNode, context: SearchTreeContext): TreeValue | null {
  return typeOf(node, "", context, []);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** The rule a tree breaks: R1–R8, or `shape` — a node's own parameters. */
export type SearchTreeRule = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "shape";

export interface SearchTreeViolation {
  rule: SearchTreeRule;
  /** Dotted path from the root (`""`) through `input`, `inputs.<i>` and
   * `filters.<i>`. */
  path: string;
  message: string;
}

/**
 * Check a tree against the rules, reporting every violation:
 *
 * - R1 a merge's rankings share one score kind;
 * - R2 every search node reaches the root through exactly one group, below
 *   every fuse;
 * - R3 a rank-only ranking is only fused, restricted, appended to or cut;
 * - R4 a fuse or merge combines one result unit; append ranks entities;
 * - R5 a floor lives in a semantic search;
 * - R6 entity ids enter a ranking only through restrict or append;
 * - R7 nodes name what the lens shows: a searchable index, an exposed type;
 * - R8 the root is a ranking of the result unit — entities or passages.
 */
export function validateSearchTree(tree: TreeNode, context: SearchTreeContext): SearchTreeViolation[] {
  const violations: SearchTreeViolation[] = [];
  const value = typeOf(tree, "", context, violations);
  if (value?.unit === "entries") {
    violations.push({
      rule: "R2",
      path: "",
      message: "A search node reaches the root through exactly one group; these entries are not grouped",
    });
  } else if (value?.unit === "entityIds") {
    violations.push({ rule: "R8", path: "", message: "The root is a ranking of entities or passages, not entity ids" });
  }
  return violations;
}

type Ranking = Extract<TreeValue, { scoreKind: ScoreKind }>;

function sameScoreKind(a: ScoreKind, b: ScoreKind): boolean {
  if (a.kind === "semanticSimilarity" && b.kind === "semanticSimilarity") {
    return a.model === b.model && a.text === b.text;
  }
  if (a.kind === "keywordScore" && b.kind === "keywordScore") {
    return a.text === b.text && a.match === b.match;
  }
  return a.kind === b.kind;
}

/** The value of a node, its inputs checked first; null when it, or an
 * input it depends on, breaks a rule — a node above does not report again
 * what follows from that. */
function typeOf(
  node: TreeNode,
  path: string,
  context: SearchTreeContext,
  violations: SearchTreeViolation[],
): TreeValue | null {
  const refuse = (rule: SearchTreeRule, message: string, at = path): null => {
    violations.push({ rule, path: at, message });
    return null;
  };
  const inputs = inputsOf(node).map(([segment, input]) => {
    const at = path === "" ? segment : `${path}.${segment}`;
    return { path: at, value: typeOf(input, at, context, violations) };
  });
  // The inputs that must be rankings: entity ids refused (R6), a rank-only
  // ranking too where only a scored one fits (R3). Null when one does not
  // fit.
  const rankings = (of: typeof inputs, scored: boolean): Ranking[] | null => {
    if (of.some((input) => input.value === null)) return null;
    const misfits = of.filter((input) => {
      if (input.value!.unit === "entityIds") {
        refuse("R6", "Entity ids enter a ranking only through restrict or append", input.path);
        return true;
      }
      if (scored && input.value!.scoreKind.kind === "rankOnly") {
        refuse("R3", "A rank-only ranking is only fused, restricted, appended to or cut", input.path);
        return true;
      }
      return false;
    });
    return misfits.length > 0 ? null : (of.map((input) => input.value) as Ranking[]);
  };
  // A restrict's or append's filters: entity ids, one filter per entity
  // type. Reports what does not fit.
  const checkFilters = (filters: typeof inputs, what: string) => {
    const types = new Set<string>();
    for (const filter of filters) {
      if (filter.value === null) continue;
      if (filter.value.unit !== "entityIds") {
        refuse("R6", `${what} takes the entity ids of a filter; this is a ranking`, filter.path);
      } else if (types.has(filter.value.entityType)) {
        refuse("shape", `${what} has one filter per entity type; '${filter.value.entityType}' has two`, filter.path);
      } else {
        types.add(filter.value.entityType);
      }
    }
  };

  switch (node.kind) {
    case "keywordSearch":
    case "semanticSearch": {
      if (!context.indices.has(node.index)) refuse("R7", `Search index '${node.index}' is not searchable in this lens`);
      if (node.kind === "keywordSearch" && "minSimilarity" in node) {
        return refuse("R5", "A floor lives in a semantic search; keyword scores have none");
      }
      if (node.text.trim() === "") return refuse("shape", "A search node needs a query text");
      if (node.parts !== undefined && node.parts.length === 0) {
        return refuse("shape", "A search node's parts name at least one part");
      }
      if (node.kind === "keywordSearch") {
        return { unit: "entries", scoreKind: { kind: "keywordScore", text: node.text, match: node.match } };
      }
      const floor = node.minSimilarity;
      if (floor !== undefined && !(floor >= 0 && floor <= 1)) {
        return refuse("shape", "minSimilarity is a number from 0 to 1");
      }
      return { unit: "entries", scoreKind: { kind: "semanticSimilarity", model: context.model, text: node.text } };
    }
    case "filter":
      if (!context.entityTypes.has(node.entityType)) {
        refuse("R7", `Entity type '${node.entityType}' is not in this lens`);
      }
      return { unit: "entityIds", entityType: node.entityType };
    case "merge": {
      if (inputs.length === 0) return refuse("shape", "A merge needs at least one ranking");
      const merged = rankings(inputs, true);
      if (merged === null) return null;
      if (merged.some((value) => value.unit !== merged[0]!.unit)) {
        return refuse("R4", "A merge combines rankings of one result unit");
      }
      if (merged.some((value) => !sameScoreKind(value.scoreKind, merged[0]!.scoreKind))) {
        return refuse(
          "R1",
          "A merge combines rankings of one score kind: one method, query text and model; else fuse them",
        );
      }
      return merged[0]!;
    }
    case "group": {
      const [input] = rankings(inputs, true) ?? [];
      if (input === undefined) return null;
      if (input.unit !== "entries") {
        return refuse("R2", "A search node reaches the root through exactly one group; this one groups grouped items");
      }
      return { unit: node.key === "entity" ? "entities" : "passages", scoreKind: input.scoreKind };
    }
    case "fuse": {
      if (inputs.length === 0) return refuse("shape", "A fuse needs at least one ranking");
      const fused = rankings(inputs, false);
      if (fused === null) return null;
      if (fused.some((value) => value.unit === "entries")) {
        return refuse("R2", "A fuse combines grouped rankings: a group below every fuse, so an item votes once");
      }
      if (fused.some((value) => value.unit !== fused[0]!.unit)) {
        return refuse("R4", "A fuse combines rankings of one result unit");
      }
      return { unit: fused[0]!.unit, scoreKind: { kind: "rankOnly" } };
    }
    case "restrict": {
      const [input, ...filters] = inputs;
      if (filters.length === 0) refuse("shape", "A restrict needs at least one filter");
      checkFilters(filters, "A restrict");
      return rankings([input!], false)?.[0] ?? null;
    }
    case "append": {
      const ranked = node.input === null ? [] : inputs.slice(0, 1);
      const filters = inputs.slice(ranked.length);
      if (filters.length === 0) refuse("shape", "An append needs at least one filter");
      if (!Number.isInteger(node.until) || node.until < 1) refuse("shape", "An append's until is a positive integer");
      checkFilters(filters, "An append");
      const appended: TreeValue = { unit: "entities", scoreKind: { kind: "rankOnly" } };
      if (ranked.length === 0) return appended;
      const [ranking] = rankings(ranked, false) ?? [];
      if (ranking === undefined) return null;
      if (ranking.unit === "entries") {
        return refuse("R2", "An append adds to grouped entities; group the entries first");
      }
      if (ranking.unit !== "entities") return refuse("R4", "An append adds to a ranking of entities");
      return appended;
    }
    case "cut": {
      if (!Number.isInteger(node.limit) || node.limit < 1 || node.limit > 100) {
        refuse("shape", "A cut's limit is an integer from 1 to 100");
      }
      const perEntity = node.perEntity;
      if (perEntity !== undefined && !(Number.isInteger(perEntity) && perEntity >= 1 && perEntity <= node.limit)) {
        refuse("shape", "A cut's perEntity is an integer from 1 to its limit");
      }
      const [input] = rankings(inputs, false) ?? [];
      if (input === undefined) return null;
      if (input.unit === "entries") {
        return refuse("R2", "A search node reaches the root through exactly one group; these entries are not grouped");
      }
      if (perEntity !== undefined && input.unit !== "passages") {
        return refuse("shape", "perEntity cuts a ranking of passages");
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
 * sorted), the ids and relation types of a node sorted.
 */
export function printSearchTree(tree: TreeNode): string {
  const lines: string[] = [];
  const print = (node: TreeNode, lead: string, indent: string) => {
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

function label(node: TreeNode): string {
  const subQuery = (of: { subQuery?: number }) => (of.subQuery === undefined ? [] : [`sub-query ${of.subQuery}`]);
  switch (node.kind) {
    case "keywordSearch":
    case "semanticSearch":
      return `${node.kind}(${[
        node.index,
        JSON.stringify(node.text),
        ...(node.kind === "keywordSearch" ? [`match ${node.match}`] : []),
        ...(node.kind === "semanticSearch" && node.minSimilarity !== undefined
          ? [`minSimilarity ${node.minSimilarity}`]
          : []),
        ...(node.relations === null ? [] : [`relations ${canonical([...node.relations].sort())}`]),
        ...(node.parts === undefined ? [] : [`parts ${canonical([...node.parts].sort())}`]),
        ...subQuery(node),
      ].join(", ")})`;
    case "filter":
      return `filter(${[
        node.entityType,
        ...(node.conditions.length === 0 ? [] : [`where ${canonical(node.conditions)}`]),
        ...(node.ids === null ? [] : [`ids ${canonical([...node.ids].sort())}`]),
      ].join(", ")})`;
    case "group":
      return `group(${node.key})`;
    case "append":
      return `append(${[`until ${node.until}`, ...subQuery(node)].join(", ")})`;
    case "cut":
      return `cut(${[
        `limit ${node.limit}`,
        ...(node.perEntity === undefined ? [] : [`perEntity ${node.perEntity}`]),
      ].join(", ")})`;
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
