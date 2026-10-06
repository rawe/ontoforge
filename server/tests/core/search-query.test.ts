/**
 * The query side of search indices, pure part: availability in a lens,
 * hidden-property detection, the bilingual keyword query, merging per mode,
 * grouping and reciprocal-rank fusion across modes, the snippet; and the helpers of the switched-off
 * managed indices and of definition comparison.
 */

import { describe, expect, it } from "vitest";

import {
  definitionsEqual,
  deriveManagedIndices,
  SearchIndexDefinition,
  type SearchIndexSchema,
} from "../../src/core/searchIndex.js";
import { disabledDefaultsOf, disabledIndexKeys } from "../../src/core/searchPipeline.js";
import {
  availableIndices,
  fuseModes,
  groupByEntity,
  keywordTsquery,
  lensIndexFindings,
  mergeByScore,
  readsHiddenProperties,
  RRF_K,
  snippet,
  SNIPPET_LENGTH,
  type ModeRanking,
} from "../../src/core/searchQuery.js";
import { schema } from "./searchSchema.js";

const index = (key: string, entityType: string) => ({ key, definition: { entityType } });

describe("availableIndices", () => {
  const indices = [
    index("person~default", "person"),
    index("person~bio", "person"),
    index("company~default", "company"),
    index("employment", "person"),
  ];

  it("an unscoped lens searches every index of the types it exposes", () => {
    const lens = {
      scoped: false,
      exposedEntityTypes: new Set(["person", "company"]),
      includedIndices: new Set<string>(),
    };
    expect(availableIndices(indices, lens, new Set()).map((i) => i.key)).toEqual([
      "person~default",
      "person~bio",
      "company~default",
      "employment",
    ]);
  });

  it("a scoped lens searches the indices it includes whose root type it exposes", () => {
    const lens = {
      scoped: true,
      exposedEntityTypes: new Set(["person"]),
      // `company~default` is included, but the lens no longer shows companies.
      includedIndices: new Set(["person~default", "employment", "company~default"]),
    };
    expect(availableIndices(indices, lens, new Set()).map((i) => i.key)).toEqual([
      "person~default",
      "employment",
    ]);
  });

  it("a switched-off managed index is searchable nowhere", () => {
    const lens = {
      scoped: false,
      exposedEntityTypes: new Set(["person", "company"]),
      includedIndices: new Set<string>(),
    };
    expect(
      availableIndices(indices, lens, new Set(["person~bio"])).map((i) => i.key),
    ).not.toContain("person~bio");
  });
});

describe("readsHiddenProperties", () => {
  const employment = SearchIndexDefinition.parse({
    key: "employment",
    name: "Employment",
    description: "People by employer",
    entityType: "person",
    fields: ["email"],
    relations: [
      {
        relationType: "works_for",
        direction: "outgoing",
        fields: ["role"],
        target: { company: ["name"] },
      },
    ],
  });
  /** The schema with some properties removed, as a scoped lens shows it. */
  function hiding(hidden: Record<string, string[]>, hiddenTypes: string[] = []): SearchIndexSchema {
    const copy = structuredClone(schema);
    for (const [type, keys] of Object.entries(hidden)) {
      const owner = copy.entityTypes[type] ?? copy.relationTypes[type]!;
      for (const key of keys) delete owner.properties[key];
    }
    for (const type of hiddenTypes) {
      delete copy.entityTypes[type];
      delete copy.relationTypes[type];
    }
    return copy;
  }

  it("is false when the lens shows everything the index reads", () => {
    expect(readsHiddenProperties(employment, schema, schema)).toBe(false);
  });

  it("is true for a hidden own field, header field, relation field or target field", () => {
    expect(readsHiddenProperties(employment, schema, hiding({ person: ["email"] }))).toBe(true);
    expect(readsHiddenProperties(employment, schema, hiding({ person: ["name"] }))).toBe(true);
    expect(readsHiddenProperties(employment, schema, hiding({ works_for: ["role"] }))).toBe(true);
    expect(readsHiddenProperties(employment, schema, hiding({ company: ["name"] }))).toBe(true);
  });

  it("ignores the fields of a group whose relation type the lens hides", () => {
    expect(
      readsHiddenProperties(employment, schema, hiding({ company: ["name"] }, ["works_for"])),
    ).toBe(false);
  });
});

describe("lensIndexFindings", () => {
  const employment = SearchIndexDefinition.parse({
    key: "employment",
    name: "Employment",
    description: "People by employer",
    entityType: "person",
    fields: ["email", "age"],
    relations: [
      {
        relationType: "works_for",
        direction: "outgoing",
        fields: ["role", "since"],
        target: { company: ["name", "founded"] },
        label: "Employment",
      },
      { relationType: "lives_in", direction: "outgoing", target: { city: ["name"] } },
    ],
  });
  function hiding(hidden: Record<string, string[]>, hiddenTypes: string[] = []): SearchIndexSchema {
    const copy = structuredClone(schema);
    for (const [type, keys] of Object.entries(hidden)) {
      const owner = copy.entityTypes[type] ?? copy.relationTypes[type]!;
      for (const key of keys) delete owner.properties[key];
    }
    for (const type of hiddenTypes) {
      delete copy.entityTypes[type];
      delete copy.relationTypes[type];
    }
    return copy;
  }
  const paths = (scoped: SearchIndexSchema, definition = employment) =>
    lensIndexFindings(definition, schema, scoped).map((f) => `${f.kind} ${f.path}`);

  it("finds nothing when the lens shows everything the index reads", () => {
    expect(lensIndexFindings(employment, schema, schema)).toEqual([]);
  });

  it("reports only the root type when the lens does not expose it", () => {
    const findings = lensIndexFindings(employment, schema, hiding({ company: ["name"] }, ["person"]));
    expect(findings).toEqual([
      {
        kind: "rootHidden",
        path: "entityType",
        message:
          "Search index 'employment' is not searchable in this lens: its root entity type 'person' is not included",
      },
    ]);
  });

  it("reports every hidden own, header, relation and target field by its path", () => {
    expect(paths(hiding({ person: ["age", "name"], works_for: ["since"], company: ["founded"] }))).toEqual([
      "hiddenProperty fields.1",
      // The header follows the name property (header: null).
      "hiddenProperty header",
      "hiddenProperty relations.0.fields.1",
      "hiddenProperty relations.0.target.company.1",
    ]);
    const [own] = lensIndexFindings(employment, schema, hiding({ person: ["age"] }));
    expect(own!.message).toBe(
      "Search index 'employment' reads property 'age' of entity type 'person', which this lens hides",
    );
  });

  it("names an explicit header field by its position, and an own field only once", () => {
    const headed = { ...employment, header: ["email", "name"] };
    expect(paths(hiding({ person: ["email", "name"] }), headed)).toEqual([
      "hiddenProperty fields.0",
      "hiddenProperty header.1",
    ]);
  });

  it("reports no group the lens skips — a hidden relation type or other end — nor its fields", () => {
    // Entries of such groups are skipped at query time: no rebuild, no warning.
    expect(lensIndexFindings(employment, schema, hiding({ company: ["name"] }, ["works_for"]))).toEqual([]);
    expect(lensIndexFindings(employment, schema, hiding({ city: ["name"] }, ["city"]))).toEqual([]);
    expect(readsHiddenProperties(employment, schema, hiding({}, ["city", "works_for"]))).toBe(false);
  });

  it("follows the direction of an incoming group to its other end", () => {
    const employers = SearchIndexDefinition.parse({
      key: "employers",
      name: "Employers",
      description: "Companies by staff",
      entityType: "company",
      fields: ["name"],
      relations: [{ relationType: "works_for", direction: "incoming", target: { person: ["email"] } }],
    });
    expect(paths(hiding({ person: ["email"] }), employers)).toEqual(["hiddenProperty relations.0.target.person.0"]);
    expect(paths(hiding({}, ["person"]), employers)).toEqual([]);
  });
});

describe("keywordTsquery", () => {
  it("joins one language's lexemes as prefix terms — any or all", () => {
    expect(keywordTsquery([["graph", "databas"]], "any")).toBe("('graph':* | 'databas':*)");
    expect(keywordTsquery([["graph", "databas"]], "all")).toBe("('graph':* & 'databas':*)");
  });

  it("ORs the languages of a bilingual set", () => {
    expect(keywordTsquery([["haus", "kauf"], ["hauser", "kaufen"]], "all")).toBe(
      "('haus':* & 'kauf':*) | ('hauser':* & 'kaufen':*)",
    );
    expect(keywordTsquery([["haus"], ["hous"]], "any")).toBe("('haus':*) | ('hous':*)");
  });

  it("states a clause both languages produce once", () => {
    expect(keywordTsquery([["graph"], ["graph"]], "any")).toBe("('graph':*)");
  });

  it("skips a language with only stop words and is null when every one has none", () => {
    expect(keywordTsquery([[], ["graph"]], "all")).toBe("('graph':*)");
    expect(keywordTsquery([[], []], "any")).toBeNull();
    expect(keywordTsquery([], "any")).toBeNull();
  });

  it("quotes lexemes so no input reaches tsquery syntax", () => {
    expect(keywordTsquery([["o'neil", "a\\b"]], "any")).toBe("('o''neil':* | 'a\\\\b':*)");
  });
});

describe("grouping and fusion", () => {
  type E = { entityId: string; index: string; partId: string; score: number };
  const e = (entityId: string, index: string, partId: string, score: number): E => ({
    entityId,
    index,
    partId,
    score,
  });
  const mode = (representation: "semantic" | "keyword", lists: E[][]): ModeRanking<E> => ({
    representation,
    entries: mergeByScore(lists),
  });
  const rrf = (rank: number) => 1 / (RRF_K + rank);

  it("groups by entity and keeps each entity's best (first) entry", () => {
    const ranked = [e("a", "x", "1", 0.9), e("b", "x", "", 0.8), e("a", "x", "2", 0.7)];
    expect(groupByEntity(ranked)).toEqual([ranked[0], ranked[1]]);
  });

  it("merges the indices of one mode by raw score", () => {
    expect(
      mergeByScore([
        [e("a", "person~default", "", 3), e("b", "person~default", "", 1)],
        [e("c", "company~default", "", 2)],
      ]).map((x) => x.entityId),
    ).toEqual(["a", "c", "b"]);
  });

  it("a single mode ranks across indices by the best entry's own score — no tie between the indices' tops", () => {
    const fused = fuseModes([
      mode("keyword", [
        [e("p1", "paper~default", "", 0.6), e("p2", "paper~default", "", 0.1)],
        [e("r1", "report~default", "", 0.3)],
        [e("c1", "company~default", "", 0.9)],
      ]),
    ]);
    expect(fused.map((h) => [h.entityId, h.score])).toEqual([
      ["c1", 0.9],
      ["p1", 0.6],
      ["r1", 0.3],
      ["p2", 0.1],
    ]);
  });

  it("an entity found by its default and its passage index counts once in a mode — no additive bonus", () => {
    const fused = fuseModes([
      mode("keyword", [
        [e("a", "paper~default", "", 0.5), e("b", "paper~default", "", 0.4)],
        [e("a", "paper~body", "3", 0.45), e("b", "paper~body", "0", 0.7)],
      ]),
    ]);
    expect(fused.map((h) => [h.entityId, h.score])).toEqual([
      ["b", 0.7],
      ["a", 0.5],
    ]);
    expect(fused[0]!.matched.entry).toMatchObject({ index: "paper~body", partId: "0" });
  });

  it("fuses the modes by reciprocal rank; matched comes from the mode the entity ranks best in", () => {
    const fused = fuseModes([
      mode("semantic", [[e("a", "x", "", 0.9), e("b", "x", "s", 0.8)]]),
      mode("keyword", [[e("b", "x", "k", 3), e("c", "x", "", 1)]]),
    ]);
    expect(fused.map((h) => h.entityId)).toEqual(["b", "a", "c"]);
    expect(fused[0]!.score).toBeCloseTo(rrf(2) + rrf(1));
    expect(fused[0]!.matched).toMatchObject({ representation: "keyword", rank: 1, entry: { partId: "k" } });
    expect(fused[0]!.modes.map((m) => m.representation)).toEqual(["semantic", "keyword"]);
  });

  it("an equal rank in both modes matches the semantic entry", () => {
    const fused = fuseModes([
      mode("semantic", [[e("a", "x", "s", 0.9)]]),
      mode("keyword", [[e("a", "x", "k", 2)]]),
    ]);
    expect(fused[0]!.matched).toMatchObject({ representation: "semantic", entry: { partId: "s" } });
  });

  it("breaks equal fused scores by semantic similarity when every tied hit has one, else by entity id", () => {
    const measured = fuseModes([
      mode("semantic", [[e("b", "x", "", 0.9), e("a", "x", "", 0.7)]]),
      mode("keyword", [[e("a", "x", "", 2), e("b", "x", "", 1)]]),
    ]);
    expect(measured.map((h) => h.entityId)).toEqual(["b", "a"]);
    const unmeasured = fuseModes([
      mode("semantic", [[e("z", "x", "", 0.9)]]),
      mode("keyword", [[e("m", "x", "", 2)]]),
    ]);
    expect(unmeasured.map((h) => h.entityId)).toEqual(["m", "z"]);
    expect(fuseModes([mode("keyword", [[e("z", "x", "", 1), e("m", "y", "", 1)]])]).map((h) => h.entityId)).toEqual([
      "m",
      "z",
    ]);
  });
});

describe("snippet", () => {
  it("collapses whitespace and keeps short text whole", () => {
    expect(snippet("  Person: Ada\nRole:   CTO ")).toBe("Person: Ada Role: CTO");
  });

  it("cuts long text to the snippet length, marking the cut", () => {
    const cut = snippet("é".repeat(500));
    expect(Array.from(cut)).toHaveLength(SNIPPET_LENGTH);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("switched-off managed indices and definition comparison", () => {
  it("reads only keys switched off with `true`, and writes them sorted", () => {
    expect(
      [...disabledIndexKeys({ disabledDefaults: { "b~default": true, "a~bio": true, "c~x": false } })],
    ).toEqual(["b~default", "a~bio"]);
    expect(disabledDefaultsOf(["b~default", "a~bio", "b~default"])).toEqual({
      "a~bio": true,
      "b~default": true,
    });
  });

  it("compares definitions whatever their key order", () => {
    const [managed] = deriveManagedIndices(schema);
    const reordered = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(managed!.definition).reverse())),
    );
    expect(definitionsEqual(managed!.definition, reordered)).toBe(true);
    expect(definitionsEqual(managed!.definition, { ...reordered, fields: ["name"] })).toBe(false);
  });
});
