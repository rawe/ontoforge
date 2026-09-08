export interface SearchEvidence {
  /** Original normalized cosine measurement; not confidence or a fused score. */
  semanticSimilarity: number | null;
  /** Missing from a limited source ranking means unknown, never a negative. */
  keywordMatch: boolean | null;
  /** Complete contributing string-property keys, when measured and lens-exposed. */
  keywordPropertyKeys?: string[] | null;
}
export const emptyEvidence = (): SearchEvidence => ({
  semanticSimilarity: null,
  keywordMatch: null,
});

/** Source measurements merge only for identical units, before passage collapse. */
function mergeEvidence(a?: SearchEvidence, b?: SearchEvidence): SearchEvidence | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    semanticSimilarity: a.semanticSimilarity ?? b.semanticSimilarity,
    keywordMatch: a.keywordMatch ?? b.keywordMatch,
    ...(a.keywordPropertyKeys !== undefined || b.keywordPropertyKeys !== undefined
      ? { keywordPropertyKeys: a.keywordPropertyKeys ?? b.keywordPropertyKeys ?? null }
      : {}),
  };
}
/** Rank fusion operates on the same unit in every input. Stable ties retain input order. */
export interface Ranked<T> {
  key: string;
  score: number;
  value: T;
  evidence?: SearchEvidence;
}
export function fuse<T>(
  rankings: Ranked<T>[][],
  merge: (a: T, b: T) => T = (a) => a,
  mode: "sum" | "max" = "sum",
): Ranked<T>[] {
  const result = new Map<string, Ranked<T>>();
  for (const ranking of rankings) {
    const seen = new Set<string>();
    ranking.forEach((row, index) => {
      if (seen.has(row.key)) return;
      seen.add(row.key);
      const prior = result.get(row.key);
      const contribution = 1 / (60 + index + 1);
      const evidence = mergeEvidence(prior?.evidence, row.evidence);
      result.set(row.key, {
        key: row.key,
        score:
          mode === "max"
            ? Math.max(prior?.score ?? 0, contribution)
            : (prior?.score ?? 0) + contribution,
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
export function refineTies<T>(
  ranking: Ranked<T>[],
  measurement: (value: T) => number | null,
): Ranked<T>[] {
  const result: Ranked<T>[] = [];
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
