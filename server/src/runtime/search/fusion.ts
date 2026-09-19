declare const scoreKind: unique symbol;
/** The kinds a ranking score can have. A ranking holds exactly one kind, assigned once
 * where the runtime reads the storage port's rows; scores are compared only within one
 * ranking and never combined across kinds. A sum of two kinds is a plain number and fits
 * no typed slot. */
export type SemanticSimilarity = number & { readonly [scoreKind]: "semanticSimilarity" };
export type KeywordScore = number & { readonly [scoreKind]: "keywordScore" };
export type FusionScore = number & { readonly [scoreKind]: "fusionScore" };
export type RankingScore = SemanticSimilarity | KeywordScore | FusionScore;

export interface SearchEvidence {
  /** Original normalized cosine measurement; not confidence or a fused score. */
  semanticSimilarity: SemanticSimilarity | null;
  /** Missing from a limited source ranking means unknown, never a negative. */
  keywordMatch: boolean | null;
  /** The adapter's native full-text ranking measurement, passed through raw. Unbounded,
   * comparable neither to semanticSimilarity nor across responses; never used to rank.
   * A number exactly when keywordMatch is true, null exactly when it is null. */
  keywordScore: KeywordScore | null;
  /** Complete contributing string-property keys, when measured and lens-exposed. */
  keywordPropertyKeys?: string[] | null;
}
export const emptyEvidence = (): SearchEvidence => ({
  semanticSimilarity: null,
  keywordMatch: null,
  keywordScore: null,
});

/** Source measurements merge only for identical units, before passage collapse. */
function mergeEvidence(a?: SearchEvidence, b?: SearchEvidence): SearchEvidence | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    semanticSimilarity: a.semanticSimilarity ?? b.semanticSimilarity,
    keywordMatch: a.keywordMatch ?? b.keywordMatch,
    keywordScore: a.keywordScore ?? b.keywordScore,
    ...(a.keywordPropertyKeys !== undefined || b.keywordPropertyKeys !== undefined
      ? { keywordPropertyKeys: a.keywordPropertyKeys ?? b.keywordPropertyKeys ?? null }
      : {}),
  };
}
/** An ordered list whose position is the rank; all fusion ever reads. */
export interface Ordered<T> {
  key: string;
  value: T;
  evidence?: SearchEvidence;
}
/** A ranking ordered by one score kind. Source rankings keep their measurement here,
 * duplicating evidence, because the similarity floor and the single-strategy relative
 * score read it from the ranking. */
export interface Ranked<T, Kind extends RankingScore> extends Ordered<T> {
  score: Kind;
}
/** Source rows take their kind here, per the port contract of the method that returned
 * them; the measurement is both the ranking score and the evidence. A keyword row lists its
 * contributing property keys only for units that attribute (entity text, not passages). */
export function semanticRow<T>(
  key: string,
  value: T,
  score: unknown,
  keywordPropertyKeys?: null,
): Ranked<T, SemanticSimilarity> {
  const similarity = score as SemanticSimilarity;
  return {
    key,
    score: similarity,
    value,
    evidence: {
      semanticSimilarity: similarity,
      keywordMatch: null,
      keywordScore: null,
      ...(keywordPropertyKeys !== undefined ? { keywordPropertyKeys } : {}),
    },
  };
}
export function keywordRow<T>(
  key: string,
  value: T,
  score: unknown,
  keywordPropertyKeys?: string[] | null,
): Ranked<T, KeywordScore> {
  const keywordScore = score as KeywordScore;
  return {
    key,
    score: keywordScore,
    value,
    evidence: {
      semanticSimilarity: null,
      keywordMatch: true,
      keywordScore,
      ...(keywordPropertyKeys !== undefined ? { keywordPropertyKeys } : {}),
    },
  };
}
/** Rank fusion operates on the same unit in every input. Stable ties retain input order. */
export function fuse<T>(
  rankings: Ordered<T>[][],
  merge: (a: T, b: T) => T = (a) => a,
  mode: "sum" | "max" = "sum",
): Ranked<T, FusionScore>[] {
  const result = new Map<string, Ranked<T, FusionScore>>();
  for (const ranking of rankings) {
    const seen = new Set<string>();
    ranking.forEach((row, index) => {
      if (seen.has(row.key)) return;
      seen.add(row.key);
      const prior = result.get(row.key);
      const contribution = 1 / (60 + index + 1);
      const evidence = mergeEvidence(prior?.evidence, row.evidence);
      // Arithmetic on a brand yields a plain number; this is the one place a fusion score is made.
      const score = (
        mode === "max"
          ? Math.max(prior?.score ?? 0, contribution)
          : (prior?.score ?? 0) + contribution
      ) as FusionScore;
      result.set(row.key, {
        key: row.key,
        score,
        value: prior ? merge(prior.value, row.value) : row.value,
        ...(evidence ? { evidence } : {}),
      });
    });
  }
  return [...result.values()].sort((a, b) => b.score - a.score);
}
export function relativeScore(score: number, best: number): number {
  return best > 0 ? Math.max(0, Math.min(1, score / best)) : 1;
}

/** Unknown measurements leave the whole tied group in stable input order. */
export function refineTies<T, Kind extends RankingScore>(
  ranking: Ranked<T, Kind>[],
  measurement: (value: T) => number | null,
): Ranked<T, Kind>[] {
  const result: Ranked<T, Kind>[] = [];
  for (let start = 0; start < ranking.length;) {
    let end = start + 1;
    while (end < ranking.length && ranking[end]!.score === ranking[start]!.score) end++;
    const group = ranking.slice(start, end).map((row) => ({
      row, measurement: measurement(row.value),
    }));
    if (group.every((item) => item.measurement !== null && Number.isFinite(item.measurement)))
      group.sort((a, b) => b.measurement! - a.measurement!);
    result.push(...group.map((item) => item.row));
    start = end;
  }
  return result;
}
