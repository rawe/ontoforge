/** Rank fusion operates on the same unit in every input. Stable ties retain input order. */
export interface Ranked<T> {
  key: string;
  score: number;
  value: T;
}
export function fuse<T>(rankings: Ranked<T>[][], merge: (a: T, b: T) => T = (a) => a): Ranked<T>[] {
  const result = new Map<string, Ranked<T>>();
  for (const ranking of rankings) {
    const seen = new Set<string>();
    ranking.forEach((row, index) => {
      if (seen.has(row.key)) return;
      seen.add(row.key);
      const prior = result.get(row.key);
      result.set(row.key, {
        key: row.key,
        score: (prior?.score ?? 0) + 1 / (60 + index + 1),
        value: prior ? merge(prior.value, row.value) : row.value,
      });
    });
  }
  return [...result.values()].sort((a, b) => b.score - a.score);
}
export function relativeScore(score: number, best: number): number {
  return best > 0 ? Math.max(0, Math.min(1, score / best)) : 1;
}
