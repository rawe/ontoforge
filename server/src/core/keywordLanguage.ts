/**
 * Keyword languages: the text-search languages keyword search stems in.
 *
 * A keyword entry is stemmed in every language of the ontology's keyword
 * language set, and a query is parsed in each. The type lives in core
 * because modeling, runtime and every adapter speak it; nothing below the
 * registry imports the registry for it.
 */

import { z } from "zod";

/** The supported languages, in canonical order. */
export const KEYWORD_LANGUAGES = ["german", "english"] as const;

export const KeywordLanguage = z.enum(KEYWORD_LANGUAGES);
export type KeywordLanguage = z.infer<typeof KeywordLanguage>;

/** A non-empty set of distinct keyword languages, in canonical order. */
export type KeywordLanguageSet = readonly KeywordLanguage[];

/** The set a new ontology starts with. */
export const DEFAULT_KEYWORD_LANGUAGES: KeywordLanguageSet = ["german", "english"];

/** Bring a set into canonical order — the order of `KEYWORD_LANGUAGES`. */
export function canonicalKeywordLanguages(set: readonly KeywordLanguage[]): KeywordLanguageSet {
  return KEYWORD_LANGUAGES.filter((language) => set.includes(language));
}

/**
 * The wire schema of a keyword language set: a non-empty array of distinct
 * languages, accepted in any order and returned in canonical order.
 */
export const KeywordLanguageSetSchema = z
  .array(KeywordLanguage)
  .min(1, "At least one keyword language is required")
  .refine((set) => new Set(set).size === set.length, "Keyword languages must be distinct")
  .transform(canonicalKeywordLanguages);
