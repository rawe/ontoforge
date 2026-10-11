/**
 * The keyword query of a search, in PostgreSQL tsquery syntax: the
 * bilingual query from the lexemes `ts_debug` yields, and the keyword
 * score `rankEntries` computes in SQL. Pure — no I/O.
 */

import type { KeywordMatching } from "../../core/ports.js";

/** One lexeme as a quoted prefix term — no caller input reaches tsquery
 * syntax. */
function prefixTerm(lexeme: string): string {
  return `'${lexeme.replaceAll("\\", "\\\\").replaceAll("'", "''")}':*`;
}

/**
 * The bilingual keyword query: per language of the generation's set, the
 * query's stemmed lexemes as prefix terms — any term (`|`) or every term
 * (`&`) — and the languages OR-ed, so a query matches in whichever
 * language stems it the way the entry was stemmed. Null when no language
 * yields a lexeme (only stop words): the query matches nothing.
 */
export function keywordTsquery(
  lexemesPerLanguage: readonly (readonly string[])[],
  matching: KeywordMatching,
): string | null {
  const operator = matching === "all" ? " & " : " | ";
  const clauses = lexemesPerLanguage
    .filter((lexemes) => lexemes.length > 0)
    .map((lexemes) => `(${lexemes.map(prefixTerm).join(operator)})`);
  const unique = [...new Set(clauses)];
  return unique.length === 0 ? null : unique.join(" | ");
}

/** One token of the keyword query as one language of the set reads it:
 * the token's position in the query, and the lexemes that language's
 * dictionaries make of it — null for a token no dictionary reads (a
 * space, punctuation), empty for a stop word of that language. Every
 * language parses with the same parser, so positions align. */
export interface KeywordQueryToken {
  language: number;
  token: number;
  lexemes: readonly string[] | null;
}

/** The keyword query of one search: what matches (`tsquery`, as
 * `keywordTsquery`), and one query per query word — its lexemes in every
 * language, OR-ed — to count the words an entry contains. */
export interface KeywordQuery {
  tsquery: string;
  words: string[];
}

/**
 * The keyword query from the query's tokens per language. A word stemmed
 * differently in German and English is still one word; a word repeated in
 * the query counts once. A word that any language of the set treats as a
 * stop word is left out in every language — otherwise another language
 * stems it ("für" in English) and it matches every entry that contains
 * it. Null when no token yields a lexeme.
 */
export function keywordQuery(
  tokens: readonly KeywordQueryToken[],
  matching: KeywordMatching,
): KeywordQuery | null {
  const stopWords = new Set(tokens.filter(({ lexemes }) => lexemes?.length === 0).map(({ token }) => token));
  const perLanguage = new Map<number, string[]>();
  const perWord = new Map<number, Set<string>>();
  for (const { language, token, lexemes } of tokens) {
    if (stopWords.has(token)) continue;
    for (const lexeme of lexemes ?? []) {
      const own = perLanguage.get(language) ?? [];
      if (!own.includes(lexeme)) own.push(lexeme);
      perLanguage.set(language, own);
      perWord.set(token, (perWord.get(token) ?? new Set()).add(lexeme));
    }
  }
  const tsquery = keywordTsquery(
    [...perLanguage].sort(([a], [b]) => a - b).map(([, lexemes]) => lexemes),
    matching,
  );
  if (tsquery === null) return null;
  const words = [...perWord]
    .sort(([a], [b]) => a - b)
    .map(([, lexemes]) => [...lexemes].map(prefixTerm).join(" | "));
  return { tsquery, words: [...new Set(words)] };
}

/**
 * The keyword score of an entry: the number of query words it contains,
 * then — as a fraction below 1 — its `ts_rank_cd` cover density. An entry
 * with more of the query's words always ranks above one with fewer; the
 * score stays monotonic in both, as fusion needs.
 */
export function keywordScore(wordsMatched: number, coverDensity: number): number {
  return wordsMatched + coverDensity / (1 + coverDensity);
}
