/**
 * A named search's stored form: a search tree (`searchTree.ts`) as plain
 * JSON, kept under a key in a lens (`docs/capabilities/named-searches.md`).
 * `$query` in a search node's text marks where the runtime query goes.
 *
 * The stored node set is the tree's without `append`, sub-queries and
 * fixed ids: a stored `filter` carries its conditions in the public
 * filter syntax, resolved against the lens when the tree is checked
 * (`runtime/search/namedSearch.ts`). Here: the shape — a field a node does
 * not define refused at its path — and the check that needs no lens.
 *
 * Pure — no storage, no I/O.
 */

import { z } from "zod";

import type { KeywordMatching, SearchPartKind } from "./ports.js";

/** Where the runtime query goes in a search node's text. */
export const QUERY_MARK = "$query";

/** A stored node. Absent `relations`: every relation type the lens shows;
 * absent `parts`: every part; absent `match`: any. */
export type StoredSearchNode =
  | {
      kind: "keywordSearch";
      index: string;
      text: string;
      match?: KeywordMatching | undefined;
      relations?: string[] | undefined;
      parts?: SearchPartKind[] | undefined;
    }
  | {
      kind: "semanticSearch";
      index: string;
      text: string;
      minSimilarity?: number | undefined;
      relations?: string[] | undefined;
      parts?: SearchPartKind[] | undefined;
    }
  | { kind: "merge"; inputs: StoredSearchNode[] }
  | { kind: "group"; key: "entity" | "passage"; input: StoredSearchNode }
  | { kind: "fuse"; inputs: StoredSearchNode[] }
  | { kind: "restrict"; input: StoredSearchNode; filters: StoredSearchNode[] }
  /** `conditions`: the entity search's filter keys and values. */
  | { kind: "filter"; entityType: string; conditions: Record<string, string> }
  | { kind: "cut"; input: StoredSearchNode; limit: number; perEntity?: number | undefined };

/** A node with exactly these fields: one it does not define is refused at
 * its path, as a saved query's search step refuses one. */
function node<const Shape extends z.ZodRawShape>(shape: Shape) {
  return z.looseObject(shape).superRefine((value, ctx) => {
    for (const key of Object.keys(value).filter((field) => !(field in shape))) {
      ctx.addIssue({ code: "custom", path: [key], message: `Unknown field of a ${value.kind} node: '${key}'` });
    }
  });
}

const Parts = z.array(z.enum(["self", "relation", "passage"]));

/** A stored search tree, node by node. The rules between nodes (R1–R8)
 * are the tree's own, checked against the lens. */
export const StoredSearchTree: z.ZodType<StoredSearchNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    node({
      kind: z.literal("keywordSearch"),
      index: z.string(),
      text: z.string(),
      match: z.enum(["any", "all"]).optional(),
      relations: z.array(z.string()).optional(),
      parts: Parts.optional(),
    }),
    node({
      kind: z.literal("semanticSearch"),
      index: z.string(),
      text: z.string(),
      minSimilarity: z.number().optional(),
      relations: z.array(z.string()).optional(),
      parts: Parts.optional(),
    }),
    node({ kind: z.literal("merge"), inputs: z.array(StoredSearchTree) }),
    node({ kind: z.literal("group"), key: z.enum(["entity", "passage"]), input: StoredSearchTree }),
    node({ kind: z.literal("fuse"), inputs: z.array(StoredSearchTree) }),
    node({ kind: z.literal("restrict"), input: StoredSearchTree, filters: z.array(StoredSearchTree) }),
    node({ kind: z.literal("filter"), entityType: z.string(), conditions: z.record(z.string(), z.string()) }),
    node({
      kind: z.literal("cut"),
      input: StoredSearchTree,
      limit: z.number().int().min(1).max(100),
      perEntity: z.number().int().min(1).optional(),
    }),
  ]),
);

/** A node's inputs, each with its path segment — the tree's own segments:
 * `input`, `inputs.<i>`, `filters.<i>`. */
export function storedInputs(of: StoredSearchNode): [string, StoredSearchNode][] {
  switch (of.kind) {
    case "merge":
    case "fuse":
      return of.inputs.map((input, i) => [`inputs.${i}`, input]);
    case "group":
    case "cut":
      return [["input", of.input]];
    case "restrict":
      return [["input", of.input], ...of.filters.map((filter, i): [string, StoredSearchNode] => [`filters.${i}`, filter])];
    default:
      return [];
  }
}

/** A path below `tree`, as errors name it: `tree.input.inputs.1`. */
export function treePath(path: string): string {
  return path === "" ? "tree" : `tree.${path}`;
}

/**
 * The rule a stored tree breaks that needs no lens, as `<path>: <message>`:
 * `$query` in at least one search node's text — else the runtime query
 * would go nowhere.
 */
export function storedTreeErrors(tree: StoredSearchNode): string[] {
  const marked = storedSearchNodes(tree).some((at) => at.text.includes(QUERY_MARK));
  return marked ? [] : [`tree: At least one search node's text holds ${QUERY_MARK}, where the runtime query goes`];
}

/** A named search as the runtime holds it, from the lens's schema cache. */
export interface NamedSearchConfig {
  key: string;
  name: string;
  description: string;
  tree: StoredSearchNode;
}

/** The search nodes of a stored tree, in tree order. */
export function storedSearchNodes(tree: StoredSearchNode): Extract<StoredSearchNode, { text: string }>[] {
  if (tree.kind === "keywordSearch" || tree.kind === "semanticSearch") return [tree];
  return storedInputs(tree).flatMap(([, input]) => storedSearchNodes(input));
}

/** What a stored tree ranks — the unit of its root (R8), set by the group
 * its first ranking reaches. A tree checked at save always reaches one. */
export function namedSearchResult(tree: StoredSearchNode): "entities" | "passages" {
  switch (tree.kind) {
    case "group":
      return tree.key === "entity" ? "entities" : "passages";
    case "cut":
    case "restrict":
      return namedSearchResult(tree.input);
    case "merge":
    case "fuse":
      if (tree.inputs[0] !== undefined) return namedSearchResult(tree.inputs[0]);
      break;
  }
  throw new Error(`A stored search tree with '${tree.kind}' here ranks nothing`);
}

/** The tree with `query` in place of every `$query` in its search nodes'
 * texts, as written — no character of the query is special. */
export function withQuery(tree: StoredSearchNode, query: string): StoredSearchNode {
  switch (tree.kind) {
    case "keywordSearch":
    case "semanticSearch":
      return { ...tree, text: tree.text.split(QUERY_MARK).join(query) };
    case "merge":
    case "fuse":
      return { ...tree, inputs: tree.inputs.map((input) => withQuery(input, query)) };
    case "group":
    case "cut":
    case "restrict":
      return { ...tree, input: withQuery(tree.input, query) };
    case "filter":
      return tree;
  }
}
