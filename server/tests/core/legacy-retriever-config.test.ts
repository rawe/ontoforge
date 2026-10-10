/**
 * The version-1 → version-2 retriever conversion (spec §10.3): buckets
 * become default and passage indices, hard conditions filters, soft
 * conditions warnings naming the relation path; answer fields, threshold
 * and characters stay.
 */

import { describe, expect, it } from "vitest";

import { convertLegacyRetrieverConfig, legacyRetrieverKey } from "../../src/core/legacyRetrieverConfig.js";
import { RetrieverConfig, similarityFloor } from "../../src/core/retriever.js";

const DATA_TYPES: Record<string, string> = {
  "aussteller.name": "string",
  "aussteller.kurzbeschreibung": "string",
  "aussteller.profil": "document",
  "event.name": "string",
  "produkt.name": "string",
};
const dataTypeOf = (type: string, field: string) => DATA_TYPES[`${type}.${field}`];

const hop = (relationTypeKey: string, direction = "outgoing") => ({ relationTypeKey, direction });

/** Shaped like a real 5.x trade-fair retriever: condition ids repeat across buckets. */
const LEGACY = {
  buckets: [
    {
      entityTypeKey: "aussteller",
      searchFields: ["kurzbeschreibung", "name", "profil"],
      answerFields: ["name", "stand"],
      conditions: [
        { id: "rule-1", mode: "soft", path: [hop("aussteller_in_branche")], targetField: "name", textFields: ["name"] },
        { id: "rule-2", mode: "hard", path: [hop("aussteller_in_halle")], targetField: "nummer", textFields: [] },
        { id: "rule-3", mode: "hard", path: [], targetField: "name", textFields: [] },
      ],
    },
    {
      entityTypeKey: "produkt",
      searchFields: ["name"],
      answerFields: ["name"],
      conditions: [
        { id: "rule-1", mode: "hard", path: [hop("aussteller_hat_produkt", "incoming")], targetField: "name", textFields: [] },
        {
          id: "rule-2",
          mode: "soft",
          path: [hop("aussteller_hat_produkt", "incoming"), hop("aussteller_in_halle")],
          targetField: "nummer",
          textFields: ["name"],
        },
        { id: "rule-3", mode: "hard", path: [], targetField: "name", textFields: [] },
      ],
    },
  ],
  threshold: 0.4,
  answerFieldCharacters: 600,
};

describe("version-1 retriever conversion", () => {
  it("maps buckets to default and passage indices, hard conditions to filters, soft ones to warnings", () => {
    const converted = convertLegacyRetrieverConfig(LEGACY, dataTypeOf)!;
    expect(converted.config).toEqual({
      indices: [{ index: "aussteller~default" }, { index: "aussteller~profil" }, { index: "produkt~default" }],
      filters: [
        { id: "rule-2", entityType: "aussteller", path: [hop("aussteller_in_halle")], field: "nummer" },
        { id: "rule-3", entityType: "aussteller", path: [], field: "name" },
        { id: "rule-1", entityType: "produkt", path: [hop("aussteller_hat_produkt", "incoming")], field: "name" },
        // The id is taken by the first bucket's filter: prefixed with the type.
        { id: "produkt_rule-3", entityType: "produkt", path: [], field: "name" },
      ],
      answerFields: { aussteller: ["name", "stand"], produkt: ["name"] },
      threshold: 0.4,
      answerFieldCharacters: 600,
    });
    expect(converted.warnings).toEqual([
      "Soft condition 'rule-1' of aussteller was dropped: it needs a custom index with relation group " +
        "aussteller_in_branche (outgoing).",
      "Soft condition 'rule-2' of produkt was dropped: it needs a custom index with relation group " +
        "aussteller_hat_produkt (incoming) → aussteller_in_halle (outgoing).",
    ]);
    // The result is a version-2 shape.
    expect(RetrieverConfig.safeParse(converted.config).success).toBe(true);
  });

  it("a bucket searching only documents gets only passage indices; defaults fill threshold and characters", () => {
    const converted = convertLegacyRetrieverConfig(
      { buckets: [{ entityTypeKey: "aussteller", searchFields: ["profil"], answerFields: ["name"], conditions: [] }] },
      dataTypeOf,
    )!;
    expect(converted.config).toMatchObject({
      indices: [{ index: "aussteller~profil" }],
      filters: [],
      threshold: 0.35,
      answerFieldCharacters: 800,
    });
    expect(converted.warnings).toEqual([]);
  });

  it("an unknown field counts as a string field", () => {
    const converted = convertLegacyRetrieverConfig(
      { buckets: [{ entityTypeKey: "ghost", searchFields: ["x"], answerFields: ["x"], conditions: [] }] },
      dataTypeOf,
    )!;
    expect(converted.config.indices).toEqual([{ index: "ghost~default" }]);
  });

  it("an unreadable configuration is not converted", () => {
    expect(convertLegacyRetrieverConfig({ buckets: 7 }, dataTypeOf)).toBeNull();
    expect(convertLegacyRetrieverConfig(null, dataTypeOf)).toBeNull();
  });
});

describe("version-1 retriever keys", () => {
  it("keeps a key the shared rules allow", () => {
    expect(legacyRetrieverKey("finder", new Set(["finder"]))).toEqual({ key: "finder", warning: null });
  });

  it("turns '-' into '_' and names the rename", () => {
    expect(legacyRetrieverKey("fair-search", new Set(["fair-search"]))).toEqual({
      key: "fair_search",
      warning: "Key renamed from 'fair-search' to 'fair_search'.",
    });
  });

  it("resolves a clash in the lens with a numeric suffix, within the length limit", () => {
    expect(legacyRetrieverKey("a-b", new Set(["a_b", "a_b_2"])).key).toBe("a_b_3");
    const long = `${"x".repeat(63)}-`;
    const renamed = legacyRetrieverKey(long, new Set([`${"x".repeat(63)}_`]));
    expect(renamed.key).toBe(`${"x".repeat(62)}_2`);
    expect(renamed.key).toHaveLength(64);
  });
});

describe("retriever threshold", () => {
  it("maps the cosine threshold onto the search's (1 + cosine) / 2 scale (A5)", () => {
    expect(similarityFloor(0.35)).toBeCloseTo(0.675);
    expect(similarityFloor(-1)).toBe(0);
    expect(similarityFloor(1)).toBe(1);
  });

  it("defaults threshold and answer characters", () => {
    const parsed = RetrieverConfig.parse({ indices: [{ index: "a~default" }], answerFields: { a: ["name"] } });
    expect(parsed).toEqual({
      indices: [{ index: "a~default" }],
      filters: [],
      answerFields: { a: ["name"] },
      threshold: 0.35,
      answerFieldCharacters: 800,
    });
  });
});
