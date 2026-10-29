/**
 * The search tree, pure part: the values its nodes yield (unit and scale),
 * the rules R1–R8 with every violation at its path, the canonical
 * printout, and the entity compiler's canonical shape.
 */

import { describe, expect, it } from "vitest";

import type { FilterCondition } from "../../src/core/ports.js";
import { compileEntitySearch, type EntitySearch, type EntitySearchTarget } from "../../src/core/searchCompile.js";
import {
  printSearchTree,
  searchValue,
  validateSearchTree,
  type RankNode,
  type SearchNode,
  type SearchTreeContext,
} from "../../src/core/searchTree.js";

const context: SearchTreeContext = {
  indices: new Set(["person~default", "person~notes", "report~default", "report~body", "employment"]),
  entityTypes: new Set(["person", "report"]),
  model: "fake:hash:2",
};

const semantic = (index: string, text = "q", minSimilarity?: number): RankNode => ({
  kind: "rank",
  index,
  text,
  semantic: minSimilarity === undefined ? {} : { minSimilarity },
  relations: null,
});
const keyword = (index: string, text = "q", match: "any" | "all" = "any"): RankNode => ({
  kind: "rank",
  index,
  text,
  keyword: { match },
  relations: null,
});
const merge = (...inputs: SearchNode[]): SearchNode => ({ kind: "merge", inputs });
const group = (input: SearchNode, key: "entity" | "passage" = "entity"): SearchNode => ({ kind: "group", key, input });
const fuse = (...inputs: SearchNode[]): SearchNode => ({ kind: "fuse", inputs });
const cut = (input: SearchNode, limit = 10): SearchNode => ({ kind: "cut", input, limit });
const select = (entityType: string, ids: string[] | null = null): SearchNode => ({
  kind: "select",
  entityType,
  conditions: [],
  ids,
});

const AGE: FilterCondition[] = [{ kind: "property", propertyKey: "age", dataType: "integer", op: "gte", value: 20 }];

describe("values", () => {
  it("a rank yields entries on its method's scale", () => {
    expect(searchValue(semantic("person~default"), context)).toEqual({
      unit: "entries",
      scale: { kind: "semantic", model: "fake:hash:2", text: "q" },
    });
    expect(searchValue(keyword("person~default", "q", "all"), context)).toEqual({
      unit: "entries",
      scale: { kind: "keyword", text: "q", match: "all" },
    });
  });

  it("merge and group keep the scale; group makes entities or passages; fuse leaves only the order", () => {
    const scale = { kind: "semantic", model: "fake:hash:2", text: "q" };
    expect(searchValue(merge(semantic("person~default"), semantic("report~default")), context)).toEqual({
      unit: "entries",
      scale,
    });
    expect(searchValue(group(semantic("person~default")), context)).toEqual({ unit: "entities", scale });
    expect(searchValue(group(semantic("person~notes"), "passage"), context)).toEqual({ unit: "passages", scale });
    expect(
      searchValue(fuse(group(semantic("person~default")), group(keyword("person~default"))), context),
    ).toEqual({ unit: "entities", scale: { kind: "ordinal" } });
  });

  it("select and intersect yield a set of one type; restrict and cut keep the ranking; append is ordinal", () => {
    expect(searchValue(select("person"), context)).toEqual({ unit: "set", entityType: "person" });
    expect(searchValue({ kind: "intersect", inputs: [select("person"), select("person", ["a"])] }, context)).toEqual({
      unit: "set",
      entityType: "person",
    });
    const ranked = group(keyword("person~default"));
    const scored = searchValue(ranked, context);
    expect(searchValue({ kind: "restrict", input: ranked, sets: [select("person")] }, context)).toEqual(scored);
    expect(searchValue(cut(ranked), context)).toEqual(scored);
    expect(searchValue({ kind: "append", input: ranked, set: select("person") }, context)).toEqual({
      unit: "entities",
      scale: { kind: "ordinal" },
    });
  });

  it("a tree that breaks a rule has no value", () => {
    expect(searchValue(merge(semantic("person~default"), keyword("person~default")), context)).toBeNull();
  });
});

describe("rules", () => {
  const check = (tree: SearchNode) => validateSearchTree(tree, context);
  const rules = (tree: SearchNode) => check(tree).map(({ rule, path }) => ({ rule, path }));

  it("accepts the canonical shapes, ordinal rankings restricted and cut (room for rerank)", () => {
    expect(check(cut(group(merge(semantic("person~default"), semantic("report~default")))))).toEqual([]);
    expect(
      check(
        cut({
          kind: "restrict",
          input: fuse(group(semantic("person~default")), group(keyword("person~default"))),
          sets: [select("person"), select("report")],
        }),
      ),
    ).toEqual([]);
    const appended: SearchNode = { kind: "append", input: fuse(group(semantic("person~default"))), set: select("person") };
    expect(check(cut(appended))).toEqual([]);
  });

  describe("the trees the rules refuse", () => {
    it("R1: semantic and keyword do not merge — fuse them", () => {
      expect(rules(cut(group(merge(semantic("person~default"), keyword("person~default")))))).toEqual([
        { rule: "R1", path: "input.input" },
      ]);
    });

    it("R1: two texts are two scales", () => {
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
      const passages = merge(group(semantic("person~notes"), "passage"), group(semantic("report~body"), "passage"));
      expect(rules(cut(fuse(group(semantic("person~default")), passages)))).toEqual([{ rule: "R4", path: "input" }]);
    });

    it("R5: no floor on keyword", () => {
      const floored = { ...keyword("person~default"), keyword: { match: "any", minSimilarity: 0.8 } } as RankNode;
      expect(rules(cut(group(floored)))).toEqual([{ rule: "R5", path: "input.input" }]);
    });

    it("R3: an ordinal ranking does not merge by score", () => {
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

  it("R3: an ordinal ranking does not group", () => {
    expect(rules(cut(group(fuse(group(keyword("person~default"))))))).toEqual([{ rule: "R3", path: "input.input" }]);
  });

  it("R4: append adds to entities only", () => {
    expect(
      rules(cut({ kind: "append", input: group(semantic("person~notes"), "passage"), set: select("person") })),
    ).toEqual([{ rule: "R4", path: "input" }]);
  });

  it("R6: a set enters a ranking only through restrict or append, and a restrict keeps items in sets", () => {
    expect(rules(cut(group(merge(keyword("person~default"), select("person")))))).toEqual([
      { rule: "R6", path: "input.input.inputs.1" },
    ]);
    const ranked = group(keyword("person~default"));
    expect(rules(cut({ kind: "restrict", input: ranked, sets: [ranked] }))).toEqual([
      { rule: "R6", path: "input.sets.0" },
    ]);
    expect(rules(cut(select("person")))).toEqual([{ rule: "R6", path: "input" }]);
  });

  it("R7: leaves name a searchable index and an exposed type", () => {
    expect(rules(cut(group(keyword("ghost"))))).toEqual([{ rule: "R7", path: "input.input" }]);
    const hidden: SearchNode = { kind: "restrict", input: group(keyword("person~default")), sets: [select("company")] };
    expect(rules(cut(hidden))).toEqual([{ rule: "R7", path: "input.sets.0" }]);
  });

  it("R8: the root, and only the root, is a cut", () => {
    expect(rules(group(keyword("person~default")))).toEqual([{ rule: "R8", path: "" }]);
    expect(rules(cut(fuse(cut(group(keyword("person~default"))))))).toEqual([{ rule: "R8", path: "input.inputs.0" }]);
  });

  it("checks a node's own parameters", () => {
    const both = { ...keyword("person~default"), semantic: {} } as RankNode;
    expect(rules(cut(group(both)))).toEqual([{ rule: "shape", path: "input.input" }]);
    expect(rules(cut(group(semantic("person~default", "q", 1.5))))).toEqual([{ rule: "shape", path: "input.input" }]);
    expect(rules(cut(group(keyword("person~default")), 0))).toEqual([{ rule: "shape", path: "" }]);
  });

  it("reports every violation at once, each at its path", () => {
    const floored = { ...keyword("person~default"), keyword: { match: "any", minSimilarity: 0.8 } } as RankNode;
    expect(rules(fuse(group(semantic("ghost")), cut(group(floored))))).toEqual([
      { rule: "R7", path: "inputs.0.input" },
      { rule: "R5", path: "inputs.1.input.input" },
      { rule: "R8", path: "inputs.1" },
      { rule: "R8", path: "" },
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

  it("a hybrid search: per method a merge over the indices, grouped by entity, fused", () => {
    const tree = compileEntitySearch(search({}));
    expect(validateSearchTree(tree, context)).toEqual([]);
    expect(printSearchTree(tree)).toBe(
      [
        "cut(limit 10)",
        "└─ fuse",
        "   ├─ group(entity)",
        "   │  └─ merge",
        '   │     ├─ rank(person~default, semantic {}, "machine learning")',
        '   │     ├─ rank(report~default, semantic {}, "machine learning")',
        '   │     └─ rank(report~body, semantic {}, "machine learning")',
        "   └─ group(entity)",
        "      └─ merge",
        '         ├─ rank(person~default, keyword {"match":"any"}, "machine learning")',
        '         ├─ rank(report~default, keyword {"match":"any"}, "machine learning")',
        '         └─ rank(report~body, keyword {"match":"any"}, "machine learning")',
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
        '   └─ rank(person~default, semantic {"minSimilarity":0.75}, "machine learning")',
      ].join("\n"),
    );
    expect(searchValue(tree, context)).toMatchObject({ unit: "entities", scale: { kind: "semantic" } });
  });

  it("restrictions become one set per entity type in a restrict; relations narrow per index", () => {
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
        '   │     ├─ rank(person~default, keyword {"match":"all"}, "cto acme", relations ["belongs_to","works_for"])',
        '   │     ├─ rank(employment, keyword {"match":"all"}, "cto acme", relations ["works_for"])',
        '   │     └─ rank(report~default, keyword {"match":"all"}, "cto acme", relations ["belongs_to","works_for"])',
        '   ├─ select(person, where [{"dataType":"integer","kind":"property","op":"gte","propertyKey":"age","value":20}])',
        '   └─ select(report, ids ["r1","r2"])',
      ].join("\n"),
    );
  });

  it("a tree is plain data: it survives JSON unchanged and prints the same", () => {
    const tree = compileEntitySearch(search({ targets: [target("person~default", "person", { conditions: AGE })] }));
    const copy = JSON.parse(JSON.stringify(tree)) as SearchNode;
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
