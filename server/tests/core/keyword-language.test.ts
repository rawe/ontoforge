/**
 * Keyword language sets: non-empty, distinct, canonical order.
 */

import { describe, expect, it } from "vitest";

import {
  canonicalKeywordLanguages,
  DEFAULT_KEYWORD_LANGUAGES,
  KeywordLanguage,
  KeywordLanguageSetSchema,
} from "../../src/core/keywordLanguage.js";

describe("keyword language set", () => {
  it("defaults to german and english", () => {
    expect(DEFAULT_KEYWORD_LANGUAGES).toEqual(["german", "english"]);
  });

  it("accepts each single language and both", () => {
    expect(KeywordLanguageSetSchema.parse(["english"])).toEqual(["english"]);
    expect(KeywordLanguageSetSchema.parse(["german"])).toEqual(["german"]);
    expect(KeywordLanguageSetSchema.parse(["german", "english"])).toEqual(["german", "english"]);
  });

  it("returns both languages in canonical order whatever order arrives", () => {
    expect(KeywordLanguageSetSchema.parse(["english", "german"])).toEqual(["german", "english"]);
    expect(canonicalKeywordLanguages(["english", "german"])).toEqual(["german", "english"]);
  });

  it("rejects an empty set, duplicates and unknown languages", () => {
    expect(KeywordLanguageSetSchema.safeParse([]).success).toBe(false);
    expect(KeywordLanguageSetSchema.safeParse(["english", "english"]).success).toBe(false);
    expect(KeywordLanguageSetSchema.safeParse(["french"]).success).toBe(false);
    expect(KeywordLanguageSetSchema.safeParse("english").success).toBe(false);
  });

  it("knows exactly english and german as single languages", () => {
    expect(KeywordLanguage.options).toEqual(["german", "english"]);
    expect(KeywordLanguage.safeParse("english").success).toBe(true);
    expect(KeywordLanguage.safeParse("simple").success).toBe(false);
  });
});
