/**
 * A named search's tree against its lens (`core/namedSearch.ts` holds the
 * stored form): each stored filter's conditions resolved against its
 * entity type through the lens, then the tree's rules R1–R8
 * (`validateSearchTree`) — every failure at its path below `tree`. The
 * same check serves the save, the import and the run.
 */

import { getEmbeddingProvider } from "../../core/embedding.js";
import { storedInputs, treePath, type StoredSearchNode } from "../../core/namedSearch.js";
import type { RuntimeStore } from "../../core/ports.js";
import { validateSearchTree, type SearchTreeViolation, type TreeNode } from "../../core/searchTree.js";
import type { LoadedSchema } from "../schemaCache.js";
import { resolveSearchFilters } from "./filters.js";

/** What a tree is checked against: the lens's schema, the indices it may
 * search, and whether the adapter's search evaluates relation
 * conditions. */
export interface NamedSearchLens {
  loaded: Pick<LoadedSchema, "scoped">;
  /** The keys of the indices the lens may search. */
  indices: ReadonlySet<string>;
  store: Pick<RuntimeStore, "supportsSearchPathConditions">;
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

function compile(at: StoredSearchNode, path: string, lens: NamedSearchLens, errors: string[]): TreeNode {
  const input = (segment: string, of: StoredSearchNode) =>
    compile(of, path === "" ? segment : `${path}.${segment}`, lens, errors);
  const inputs = () => storedInputs(at).map(([segment, of]) => input(segment, of));
  switch (at.kind) {
    case "keywordSearch":
      return {
        kind: "keywordSearch",
        index: at.index,
        text: at.text,
        match: at.match ?? "any",
        relations: at.relations ?? null,
        ...(at.parts === undefined ? {} : { parts: at.parts }),
      };
    case "semanticSearch":
      return {
        kind: "semanticSearch",
        index: at.index,
        text: at.text,
        ...(at.minSimilarity === undefined ? {} : { minSimilarity: at.minSimilarity }),
        relations: at.relations ?? null,
        ...(at.parts === undefined ? {} : { parts: at.parts }),
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
