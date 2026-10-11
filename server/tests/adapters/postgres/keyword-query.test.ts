/**
 * The keyword query in tsquery syntax: the bilingual query from
 * per-language lexemes, quoted so no input reaches the syntax, and the
 * keyword score's ordering.
 */

import { describe, expect, it } from "vitest";

import { keywordQuery, keywordScore, keywordTsquery } from "../../../src/adapters/postgres/keywordQuery.js";

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

describe("keywordQuery", () => {
  // "Häuser kaufen und CTO" as German (1) and English (2) read it.
  const tokens = [
    { language: 1, token: 1, lexemes: ["haus"] },
    { language: 1, token: 2, lexemes: null },
    { language: 1, token: 3, lexemes: ["kauf"] },
    { language: 1, token: 5, lexemes: [] },
    { language: 1, token: 7, lexemes: ["cto"] },
    { language: 2, token: 1, lexemes: ["hauser"] },
    { language: 2, token: 3, lexemes: ["kaufen"] },
    { language: 2, token: 5, lexemes: ["und"] },
    { language: 2, token: 7, lexemes: ["cto"] },
  ];

  it("matches as keywordTsquery and counts each query word once across its stems", () => {
    expect(keywordQuery(tokens, "any")).toEqual({
      tsquery: "('haus':* | 'kauf':* | 'cto':*) | ('hauser':* | 'kaufen':* | 'cto':*)",
      words: ["'haus':* | 'hauser':*", "'kauf':* | 'kaufen':*", "'cto':*"],
    });
  });

  it("leaves out a word any language of the set treats as a stop word, in every language", () => {
    // "Marktforschung für the": "für" is a German stop word, "the" an English one.
    const mixed = [
      { language: 1, token: 1, lexemes: ["marktforsch"] },
      { language: 1, token: 3, lexemes: [] },
      { language: 1, token: 5, lexemes: ["the"] },
      { language: 2, token: 1, lexemes: ["marktforschung"] },
      { language: 2, token: 3, lexemes: ["für"] },
      { language: 2, token: 5, lexemes: [] },
    ];
    expect(keywordQuery(mixed, "all")).toEqual({
      tsquery: "('marktforsch':*) | ('marktforschung':*)",
      words: ["'marktforsch':* | 'marktforschung':*"],
    });
    // Stop words alone match nothing.
    expect(keywordQuery(mixed.filter(({ token }) => token !== 1), "any")).toBeNull();
  });

  it("counts a repeated word once and is null without any lexeme", () => {
    const repeated = [
      { language: 1, token: 1, lexemes: ["acm"] },
      { language: 1, token: 3, lexemes: ["acm"] },
    ];
    expect(keywordQuery(repeated, "all")!.words).toEqual(["'acm':*"]);
    expect(keywordQuery([{ language: 1, token: 1, lexemes: [] }], "any")).toBeNull();
  });
});

describe("keywordScore", () => {
  it("ranks more query words first, then cover density, monotonically", () => {
    expect(keywordScore(2, 0.01)).toBeGreaterThan(keywordScore(1, 100));
    expect(keywordScore(1, 0.5)).toBeGreaterThan(keywordScore(1, 0.2));
    expect(keywordScore(1, 1e9)).toBeLessThan(2);
    expect(keywordScore(0, 0)).toBe(0);
  });
});
