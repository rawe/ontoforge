/**
 * The search tree, pure part: the values its nodes yield (unit and score
 * kind), the rules R1–R8 with every violation at its path, the canonical
 * printout, and the entity, passage and planner compilers' canonical
 * shapes.
 */

import { describe, expect, it } from "vitest";

import type { FilterCondition, SearchPartKind } from "../../src/core/ports.js";
import {
  compileEntitySearch,
  compilePassageSearch,
  compilePlannedSearch,
  type EntitySearch,
  type EntitySearchTarget,
  type PlannedSubQuery,
} from "../../src/core/searchCompile.js";
import {
  printSearchTree,
  treeValue,
  validateSearchTree,
  type KeywordSearchNode,
  type SemanticSearchNode,
  type SearchTreeContext,
  type TreeNode,
} from "../../src/core/searchTree.js";

const context: SearchTreeContext = {
  indices: new Set(["person~default", "person~notes", "report~default", "report~body", "employment"]),
  entityTypes: new Set(["person", "report"]),
  model: "fake:hash:2",
};

const semantic = (index: string, text = "q", minSimilarity?: number): SemanticSearchNode => ({
  kind: "semanticSearch",
  index,
  text,
  ...(minSimilarity === undefined ? {} : { minSimilarity }),
  relations: null,
});
const keyword = (index: string, text = "q", match: "any" | "all" = "any"): KeywordSearchNode => ({
  kind: "keywordSearch",
  index,
  text,
  match,
  relations: null,
});
const merge = (...inputs: TreeNode[]): TreeNode => ({ kind: "merge", inputs });
const group = (input: TreeNode, key: "entity" | "passage" = "entity"): TreeNode => ({ kind: "group", key, input });
const fuse = (...inputs: TreeNode[]): TreeNode => ({ kind: "fuse", inputs });
const cut = (input: TreeNode, limit = 10): TreeNode => ({ kind: "cut", input, limit });
const filter = (entityType: string, ids: string[] | null = null): TreeNode => ({
  kind: "filter",
  entityType,
  conditions: [],
  ids,
});
const append = (input: TreeNode | null, ...filters: TreeNode[]): TreeNode => ({
  kind: "append",
  input,
  filters,
  until: 100,
});

const AGE: FilterCondition[] = [{ kind: "property", propertyKey: "age", dataType: "integer", op: "gte", value: 20 }];

describe("values", () => {
  it("a search node yields entries with its method's score kind", () => {
    expect(treeValue(semantic("person~default"), context)).toEqual({
      unit: "entries",
      scoreKind: { kind: "semanticSimilarity", model: "fake:hash:2", text: "q" },
    });
    expect(treeValue(keyword("person~default", "q", "all"), context)).toEqual({
      unit: "entries",
      scoreKind: { kind: "keywordScore", text: "q", match: "all" },
    });
  });

  it("merge and group keep the score kind; group makes entities or passages; fuse leaves only the order", () => {
    const scoreKind = { kind: "semanticSimilarity", model: "fake:hash:2", text: "q" };
    expect(treeValue(merge(semantic("person~default"), semantic("report~default")), context)).toEqual({
      unit: "entries",
      scoreKind,
    });
    expect(treeValue(group(semantic("person~default")), context)).toEqual({ unit: "entities", scoreKind });
    expect(treeValue(group(semantic("person~notes"), "passage"), context)).toEqual({ unit: "passages", scoreKind });
    expect(
      treeValue(fuse(group(semantic("person~default")), group(keyword("person~default"))), context),
    ).toEqual({ unit: "entities", scoreKind: { kind: "rankOnly" } });
  });

  it("a filter yields the entity ids of one type; restrict and cut keep the ranking; append is rank only", () => {
    expect(treeValue(filter("person"), context)).toEqual({ unit: "entityIds", entityType: "person" });
    const ranked = group(keyword("person~default"));
    const scored = treeValue(ranked, context);
    expect(treeValue({ kind: "restrict", input: ranked, filters: [filter("person")] }, context)).toEqual(scored);
    expect(treeValue(cut(ranked), context)).toEqual(scored);
    const rankOnly = { unit: "entities", scoreKind: { kind: "rankOnly" } };
    expect(treeValue(append(ranked, filter("person", ["a"])), context)).toEqual(rankOnly);
    expect(treeValue(append(null, filter("person", ["a"])), context)).toEqual(rankOnly);
  });

  it("a tree that breaks a rule has no value", () => {
    expect(treeValue(merge(semantic("person~default"), keyword("person~default")), context)).toBeNull();
  });
});

describe("rules", () => {
  const check = (tree: TreeNode) => validateSearchTree(tree, context);
  const rules = (tree: TreeNode) => check(tree).map(({ rule, path }) => ({ rule, path }));

  it("accepts the canonical shapes, rank-only rankings restricted, appended to and cut (room for rerank)", () => {
    expect(check(cut(group(merge(semantic("person~default"), semantic("report~default")))))).toEqual([]);
    expect(
      check(
        cut({
          kind: "restrict",
          input: fuse(group(semantic("person~default")), group(keyword("person~default"))),
          filters: [filter("person"), filter("report")],
        }),
      ),
    ).toEqual([]);
    expect(check(cut(append(fuse(group(semantic("person~default"))), filter("person"))))).toEqual([]);
  });

  it("a cut may sit anywhere, and the root need not be one", () => {
    const variant = (text: string) => cut(group(keyword("person~default", text)), 30);
    expect(check(fuse(append(fuse(variant("q"), variant("v1")), filter("person", ["a"])), variant("v2")))).toEqual([]);
    expect(check(append(null, filter("person", ["a"]), filter("report", ["r"])))).toEqual([]);
  });

  describe("the trees the rules refuse", () => {
    it("R1: semantic and keyword do not merge — fuse them", () => {
      expect(rules(cut(group(merge(semantic("person~default"), keyword("person~default")))))).toEqual([
        { rule: "R1", path: "input.input" },
      ]);
    });

    it("R1: two query texts are two score kinds", () => {
      expect(rules(cut(group(merge(semantic("person~default", "q"), semantic("person~default", "v1")))))).toEqual([
        { rule: "R1", path: "input.input" },
      ]);
    });

    it("R2: entries do not fuse — group first", () => {
      expect(rules(cut(fuse(semantic("person~default"), semantic("report~default"))))).toEqual([
        { rule: "R2", path: "input" },
      ]);
    });

    it("R4: entities and passages do not fuse", () => {
      const passages = group({ ...semantic("person~notes"), parts: ["passage"] }, "passage");
      expect(rules(cut(fuse(group(semantic("person~default")), passages)))).toEqual([{ rule: "R4", path: "input" }]);
    });

    it("R5: no floor on keyword", () => {
      const floored = { ...keyword("person~default"), minSimilarity: 0.8 } as KeywordSearchNode;
      expect(rules(cut(group(floored)))).toEqual([{ rule: "R5", path: "input.input" }]);
    });

    it("R3: a rank-only ranking does not merge by score", () => {
      const fused = fuse(group(semantic("person~default")), group(keyword("person~default")));
      expect(rules(cut(merge(fused, group(semantic("report~default")))))).toEqual([
        { rule: "R3", path: "input.inputs.0" },
      ]);
    });
  });

  it("R2: exactly one group on every path to the root", () => {
    expect(rules(cut(group(group(keyword("person~default")))))).toEqual([{ rule: "R2", path: "input" }]);
    expect(rules(cut(merge(keyword("person~default"), keyword("report~default"))))).toEqual([{ rule: "R2", path: "" }]);
  });

  it("R2: a cut above every search node, at the search node", () => {
    expect(rules(fuse(group(keyword("person~default")), cut(group(keyword("person~default", "v1")))))).toEqual([
      { rule: "R2", path: "inputs.0.input" },
    ]);
    expect(check(group(keyword("person~default")))).toEqual([
      {
        rule: "R2",
        path: "input",
        message: "A search node needs a cut above it: its limit sets how deep it reads",
      },
    ]);
    expect(rules(fuse(cut(group(keyword("person~default"))), cut(group(keyword("person~default", "v1")))))).toEqual([]);
  });

  it("R2: a merge combines search entries, restricted or not — never grouped rankings", () => {
    expect(check(cut(merge(group(keyword("person~default")), group(keyword("report~default")))))).toEqual([
      {
        rule: "R2",
        path: "input",
        message: "A merge combines the entries of search nodes; fuse grouped rankings instead",
      },
    ]);
    const restricted: TreeNode = { kind: "restrict", input: keyword("report~default"), filters: [filter("report")] };
    expect(rules(cut(group(merge(merge(keyword("person~default"), restricted), keyword("person~notes")))))).toEqual(
      [],
    );
  });

  it("R2: passages fuse straight from their groups, restricted or not — not from a fuse or a cut", () => {
    const passages = (text: string) => group({ ...keyword("report~body", text), parts: ["passage"] }, "passage");
    const methods = () => fuse(passages("q"), { kind: "restrict", input: passages("q"), filters: [filter("report")] });
    const refused = { rule: "R2", path: "input", message: "Passages fuse straight from their groups, not from a fuse or a cut" };
    expect(check(cut(fuse(methods(), passages("v1"))))).toEqual([refused]);
    expect(check(cut(fuse(cut(passages("q")), passages("v1"))))).toEqual([refused]);
    expect(check(cut(methods()))).toEqual([]);
    const entities = (text: string) => group(keyword("person~default", text));
    expect(check(cut(fuse(fuse(entities("q"), entities("v1")), cut(entities("v2")))))).toEqual([]);
  });

  it("R2: below a passage group a search counts passage entries only", () => {
    const refused = (path: string) => ({ rule: "R2", path, message: "A passage group counts passage entries only" });
    const bodies = (parts?: SearchPartKind[]) => ({ ...keyword("report~body"), ...(parts && { parts }) });
    expect(check(cut(group(bodies(["passage"]), "passage")))).toEqual([]);
    expect(check(cut(group(bodies(), "passage")))).toEqual([refused("input.input.parts")]);
    expect(check(cut(group(merge(bodies(["passage"]), bodies(["self", "passage"])), "passage")))).toEqual([
      refused("input.input.inputs.1.parts"),
    ]);
    expect(check(cut(group(bodies())))).toEqual([]);
  });

  it("R3: a rank-only ranking does not group", () => {
    expect(rules(cut(group(fuse(group(keyword("person~default"))))))).toEqual([{ rule: "R3", path: "input.input" }]);
  });

  it("R4: append adds to entities only", () => {
    expect(rules(cut(append(group({ ...semantic("person~notes"), parts: ["passage"] }, "passage"), filter("person"))))).toEqual([
      { rule: "R4", path: "input" },
    ]);
  });

  it("R6: entity ids enter a ranking only through restrict or append, which take a filter's", () => {
    expect(rules(cut(group(merge(keyword("person~default"), filter("person")))))).toEqual([
      { rule: "R6", path: "input.input.inputs.1" },
    ]);
    const ranked = group(keyword("person~default"));
    expect(rules(cut({ kind: "restrict", input: ranked, filters: [ranked] }))).toEqual([
      { rule: "R6", path: "input.filters.0" },
    ]);
    expect(rules(append(null, cut(ranked)))).toEqual([{ rule: "R6", path: "filters.0" }]);
    expect(rules(cut(filter("person")))).toEqual([{ rule: "R6", path: "input" }]);
  });

  it("R7: nodes name a searchable index and an exposed type", () => {
    expect(rules(cut(group(keyword("ghost"))))).toEqual([{ rule: "R7", path: "input.input" }]);
    const hidden: TreeNode = { kind: "restrict", input: group(keyword("person~default")), filters: [filter("company")] };
    expect(rules(cut(hidden))).toEqual([{ rule: "R7", path: "input.filters.0" }]);
  });

  it("R8: the root is a ranking of entities or passages", () => {
    expect(rules(filter("person"))).toEqual([{ rule: "R8", path: "" }]);
    expect(rules(merge(keyword("person~default"), keyword("report~default")))).toEqual([
      { rule: "R2", path: "inputs.0" },
      { rule: "R2", path: "inputs.1" },
      { rule: "R2", path: "" },
    ]);
    expect(rules(cut(group(keyword("person~default"))))).toEqual([]);
  });

  it("checks a node's own parameters", () => {
    expect(rules(cut(group(keyword("person~default", " "))))).toEqual([{ rule: "shape", path: "input.input" }]);
    expect(rules(cut(group(semantic("person~default", "q", 1.5))))).toEqual([{ rule: "shape", path: "input.input" }]);
    expect(rules(cut(group(keyword("person~default")), 0))).toEqual([{ rule: "shape", path: "" }]);
    expect(rules({ kind: "append", input: null, filters: [filter("person")], until: 0 })).toEqual([
      { rule: "shape", path: "" },
    ]);
    expect(rules(append(cut(group(keyword("person~default"))), filter("person"), filter("person", ["a"])))).toEqual([
      { rule: "shape", path: "filters.1" },
    ]);
  });

  it("reports every violation at once, each at its path", () => {
    const floored = { ...keyword("person~default"), minSimilarity: 0.8 } as KeywordSearchNode;
    expect(rules(cut(fuse(group(semantic("ghost")), cut(group(floored)), filter("company")), 0))).toEqual([
      { rule: "R7", path: "input.inputs.0.input" },
      { rule: "R5", path: "input.inputs.1.input.input" },
      { rule: "R7", path: "input.inputs.2" },
      { rule: "shape", path: "" },
    ]);
  });
});

describe("entity compiler and printout", () => {
  const target = (index: string, entityType: string, extra: Partial<EntitySearchTarget> = {}): EntitySearchTarget => ({
    index,
    entityType,
    conditions: [],
    entityIds: null,
    relations: null,
    ...extra,
  });
  const search = (extra: Partial<EntitySearch>): EntitySearch => ({
    text: "machine learning",
    targets: [target("person~default", "person"), target("report~default", "report"), target("report~body", "report")],
    methods: { semantic: {}, keyword: { match: "any" } },
    relations: null,
    limit: 10,
    ...extra,
  });

  it("a hybrid search: per method a search node per index, merged, grouped by entity, fused", () => {
    const tree = compileEntitySearch(search({}));
    expect(validateSearchTree(tree, context)).toEqual([]);
    expect(printSearchTree(tree)).toBe(
      [
        "cut(limit 10)",
        "└─ fuse",
        "   ├─ group(entity)",
        "   │  └─ merge",
        '   │     ├─ semanticSearch(person~default, "machine learning")',
        '   │     ├─ semanticSearch(report~default, "machine learning")',
        '   │     └─ semanticSearch(report~body, "machine learning")',
        "   └─ group(entity)",
        "      └─ merge",
        '         ├─ keywordSearch(person~default, "machine learning", match any)',
        '         ├─ keywordSearch(report~default, "machine learning", match any)',
        '         └─ keywordSearch(report~body, "machine learning", match any)',
      ].join("\n"),
    );
  });

  it("one method and one index: the single-input layers disappear, so the ranking keeps its scores", () => {
    const tree = compileEntitySearch(
      search({ targets: [target("person~default", "person")], methods: { semantic: { minSimilarity: 0.75 } } }),
    );
    expect(printSearchTree(tree)).toBe(
      [
        "cut(limit 10)",
        "└─ group(entity)",
        '   └─ semanticSearch(person~default, "machine learning", minSimilarity 0.75)',
      ].join("\n"),
    );
    expect(treeValue(tree, context)).toMatchObject({ unit: "entities", scoreKind: { kind: "semanticSimilarity" } });
  });

  it("restrictions become one filter per entity type in a restrict; relations narrow per index", () => {
    const tree = compileEntitySearch(
      search({
        text: "cto acme",
        targets: [
          target("person~default", "person", { conditions: AGE }),
          target("employment", "person", { conditions: AGE, relations: ["works_for", "advises"] }),
          target("report~default", "report", { entityIds: ["r2", "r1"] }),
        ],
        methods: { keyword: { match: "all" } },
        relations: ["works_for", "belongs_to"],
        limit: 5,
      }),
    );
    expect(validateSearchTree(tree, context)).toEqual([]);
    expect(printSearchTree(tree)).toBe(
      [
        "cut(limit 5)",
        "└─ restrict",
        "   ├─ group(entity)",
        "   │  └─ merge",
        '   │     ├─ keywordSearch(person~default, "cto acme", match all, relations ["belongs_to","works_for"])',
        '   │     ├─ keywordSearch(employment, "cto acme", match all, relations ["works_for"])',
        '   │     └─ keywordSearch(report~default, "cto acme", match all, relations ["belongs_to","works_for"])',
        '   ├─ filter(person, where [{"dataType":"integer","kind":"property","op":"gte","propertyKey":"age","value":20}])',
        '   └─ filter(report, ids ["r1","r2"])',
      ].join("\n"),
    );
  });

  it("a tree is plain data: it survives JSON unchanged and prints the same", () => {
    const tree = compileEntitySearch(search({ targets: [target("person~default", "person", { conditions: AGE })] }));
    const copy = JSON.parse(JSON.stringify(tree)) as TreeNode;
    expect(copy).toEqual(tree);
    expect(printSearchTree(copy)).toBe(printSearchTree(tree));
  });

  it("refuses targets of one type restricted differently", () => {
    expect(() =>
      compileEntitySearch(
        search({ targets: [target("person~default", "person", { conditions: AGE }), target("employment", "person")] }),
      ),
    ).toThrow("restrict it differently");
  });
});

describe("planner compiler", () => {
  const sub = (extra: Partial<PlannedSubQuery>): PlannedSubQuery => ({
    texts: ["cto acme"],
    targets: [{ index: "employment", entityType: "person", relations: ["works_for"] }],
    methods: { keyword: { match: "any" } },
    restrictions: [],
    ...extra,
  });
  const compile = (...subQueries: PlannedSubQuery[]) =>
    compilePlannedSearch({ subQueries, textLimit: 30, listLimit: 100 });

  it("per sub-query each query text cut to 30, the texts fused; restrictions a restrict and an append until 100", () => {
    const tree = compile(
      sub({ texts: ["cto acme", "chief technology officer"], restrictions: [{ entityType: "person", ids: ["p2", "p1"] }] }),
      sub({ texts: ["lives in berlin"], targets: [{ index: "person~default", entityType: "person", relations: null }] }),
    )!;
    expect(validateSearchTree(tree, context)).toEqual([]);
    expect(printSearchTree(tree)).toBe(
      [
        "fuse",
        "├─ append(until 100, sub-query 0)",
        "│  ├─ restrict",
        "│  │  ├─ fuse",
        "│  │  │  ├─ cut(limit 30)",
        "│  │  │  │  └─ group(entity)",
        '│  │  │  │     └─ keywordSearch(employment, "cto acme", match any, relations ["works_for"], sub-query 0)',
        "│  │  │  └─ cut(limit 30)",
        "│  │  │     └─ group(entity)",
        '│  │  │        └─ keywordSearch(employment, "chief technology officer", match any, relations ["works_for"], sub-query 0)',
        '│  │  └─ filter(person, ids ["p1","p2"])',
        '│  └─ filter(person, ids ["p1","p2"])',
        "└─ cut(limit 30)",
        "   └─ group(entity)",
        '      └─ keywordSearch(person~default, "lives in berlin", match any, sub-query 1)',
      ].join("\n"),
    );
  });

  it("a sub-query without a query text only lists; one that neither searches nor lists drops out", () => {
    const listed = sub({ texts: [], restrictions: [{ entityType: "person", ids: ["p1"] }, { entityType: "report", ids: [] }] });
    expect(printSearchTree(compile(sub({ texts: [] }), listed)!)).toBe(
      ["append(until 100, sub-query 1)", '├─ filter(person, ids ["p1"])', "└─ filter(report, ids [])"].join("\n"),
    );
    expect(compile(sub({ texts: [] }))).toBeNull();
  });
});

describe("passage compiler", () => {
  const rules = (tree: TreeNode) => validateSearchTree(tree, context).map(({ rule, path }) => ({ rule, path }));

  it("passage entries only, grouped by passage, fused; cut to the limit, at most perEntity per entity", () => {
    const tree = compilePassageSearch({
      text: "q",
      targets: [
        { index: "report~body", entityType: "report", conditions: AGE },
        { index: "employment", entityType: "person", conditions: [] },
      ],
      methods: { semantic: {}, keyword: { match: "any" } },
      limit: 10,
      perEntity: 2,
    });
    expect(validateSearchTree(tree, context)).toEqual([]);
    expect(treeValue(tree, context)).toMatchObject({ unit: "passages", scoreKind: { kind: "rankOnly" } });
    expect(printSearchTree(tree)).toBe(
      [
        "cut(limit 10, perEntity 2)",
        "└─ restrict",
        "   ├─ fuse",
        "   │  ├─ group(passage)",
        "   │  │  └─ merge",
        '   │  │     ├─ semanticSearch(report~body, "q", parts ["passage"])',
        '   │  │     └─ semanticSearch(employment, "q", parts ["passage"])',
        "   │  └─ group(passage)",
        "   │     └─ merge",
        '   │        ├─ keywordSearch(report~body, "q", match any, parts ["passage"])',
        '   │        └─ keywordSearch(employment, "q", match any, parts ["passage"])',
        '   └─ filter(report, where [{"dataType":"integer","kind":"property","op":"gte","propertyKey":"age","value":20}])',
      ].join("\n"),
    );
    const uncapped = compilePassageSearch({
      text: "q",
      targets: [{ index: "report~body", entityType: "report", conditions: [] }],
      methods: { keyword: { match: "all" } },
      limit: 5,
      perEntity: null,
    });
    expect(printSearchTree(uncapped)).toBe(
      ["cut(limit 5)", "└─ group(passage)", '   └─ keywordSearch(report~body, "q", match all, parts ["passage"])'].join("\n"),
    );
  });

  it("perEntity cuts passages only, 1 to the limit; parts name at least one part", () => {
    const passages = group({ ...keyword("report~body"), parts: ["passage"] }, "passage");
    expect(rules({ kind: "cut", input: passages, limit: 5, perEntity: 5 })).toEqual([]);
    expect(rules({ kind: "cut", input: passages, limit: 5, perEntity: 6 })).toEqual([{ rule: "shape", path: "" }]);
    expect(rules({ kind: "cut", input: passages, limit: 5, perEntity: 0 })).toEqual([{ rule: "shape", path: "" }]);
    expect(rules({ kind: "cut", input: group(keyword("report~body")), limit: 5, perEntity: 1 })).toEqual([
      { rule: "shape", path: "" },
    ]);
    expect(rules(cut(group({ ...keyword("report~body"), parts: [] }, "passage")))).toEqual([
      { rule: "shape", path: "input.input" },
    ]);
  });
});
