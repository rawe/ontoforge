declare const scoreKind: unique symbol;
/** The kinds a match measurement can have. Scores are compared only within one
 * ranking and never combined across kinds. */
export type SemanticSimilarity = number & { readonly [scoreKind]: "semanticSimilarity" };
export type KeywordScore = number & { readonly [scoreKind]: "keywordScore" };

export interface SearchEvidence {
  /** Original normalized cosine measurement; not confidence or a fused score. */
  semanticSimilarity: SemanticSimilarity | null;
  /** Missing from a limited source ranking means unknown, never a negative. */
  keywordMatch: boolean | null;
  /** The entry's keyword score — distinct query words matched plus the full-text rank as a
   * fraction below one. Comparable neither to semanticSimilarity nor across responses; never
   * used to rank.
   * A number exactly when keywordMatch is true, null exactly when it is null. */
  keywordScore: KeywordScore | null;
}
export function relativeScore(score: number, best: number): number {
  return best > 0 ? Math.max(0, Math.min(1, score / best)) : 1;
}
