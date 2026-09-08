import { describe, expect, it } from "vitest";
import { fuse, refineTies, type Ranked } from "../../src/runtime/search/fusion.js";

const ranking = (ids: string[]): Ranked<string[]>[] =>
  ids.map((key, index) => ({ key, value: [key], score: 100 - index }));

describe("rank fusion", () => {
  it("max uses reciprocal ranks rather than incoming scales and merges all values", () => {
    const properties = ranking(["a", "b"]);
    const documents = [{ key: "b", value: ["passage"], score: 0.001 }];
    const result = fuse([properties, documents], (a, b) => [...a, ...b], "max");
    expect(result).toEqual([
      { key: "a", value: ["a"], score: 1 / 61 },
      { key: "b", value: ["b", "passage"], score: 1 / 61 },
    ]);
  });

  it("max preserves a document-only rank-one candidate ahead of weaker property ranks", () => {
    const result = fuse([ranking(["p1", "p2", "p3"]), ranking(["document"])], undefined, "max");
    expect(result.map((row) => row.key)).toEqual(["p1", "document", "p2", "p3"]);
  });

  it("keeps within-kind sum as the default and ignores duplicate input units", () => {
    const result = fuse([ranking(["a", "a", "b"]), ranking(["b"])]);
    expect(result.map((row) => row.key)).toEqual(["b", "a"]);
    expect(result[0]!.score).toBe(1 / 63 + 1 / 61);
    expect(result[1]!.score).toBe(1 / 61);
  });

  it("evidence merging is independent of input order and does not change either source", () => {
    const semantic = { key: "a", value: ["semantic"], score: 0.87654321,
      evidence: { semanticSimilarity: 0.87654321, keywordMatch: null, keywordPropertyKeys: null } };
    const keyword = { key: "a", value: ["keyword"], score: 42,
      evidence: { semanticSimilarity: null, keywordMatch: true, keywordPropertyKeys: ["name", "role"] } };
    for (const inputs of [[[semantic], [keyword]], [[keyword], [semantic]]]) {
      expect(fuse(inputs)[0]!.evidence).toEqual({
        semanticSimilarity: 0.87654321, keywordMatch: true, keywordPropertyKeys: ["name", "role"],
      });
    }
    expect(semantic.evidence.keywordMatch).toBeNull();
    expect(keyword.evidence.semanticSimilarity).toBeNull();
  });
});


describe("complete tie groups", () => {
  it("keeps the entire group stable when any measurement is unavailable", () => {
    const rows = [
      { key: "a", score: 1, value: 0.8 },
      { key: "b", score: 1, value: null },
      { key: "c", score: 1, value: 0.9 },
    ];
    expect(refineTies(rows, (value) => value)).toEqual(rows);
  });

  it("sorts measured ties stably without crossing primary score groups", () => {
    const rows = [
      { key: "a", score: 1, value: 0.8 },
      { key: "b", score: 1, value: 0.9 },
      { key: "c", score: 1, value: 0.9 },
      { key: "d", score: 0.5, value: 0.99 },
    ];
    expect(refineTies(rows, (value) => value).map((row) => row.key)).toEqual(["b", "c", "a", "d"]);
  });
});
