import { getEmbeddingProvider } from "../../core/embedding.js";
import { fuse, type Ranked } from "./fusion.js";
export const SEARCH_STRATEGIES = ["semantic", "keyword", "hybrid"] as const;
export type SearchStrategy = (typeof SEARCH_STRATEGIES)[number];
export interface RankingKind<T> {
  semantic(): Promise<Ranked<T>[]>;
  keyword(): Promise<Ranked<T>[]>;
}
export interface SearchCapabilities {
  supportsKeywordRanking(): boolean;
}
/** Fixed preference order; every listed strategy has an implementation and requirements. */
export const strategies = [
  {
    key: "hybrid" as const,
    available: (store: SearchCapabilities) =>
      Boolean(getEmbeddingProvider()) && store.supportsKeywordRanking(),
    rank: async <T>(kind: RankingKind<T>) =>
      fuse(await Promise.all([kind.semantic(), kind.keyword()])),
  },
  {
    key: "keyword" as const,
    available: (store: SearchCapabilities) => store.supportsKeywordRanking(),
    rank: <T>(kind: RankingKind<T>) => kind.keyword(),
  },
  {
    key: "semantic" as const,
    available: () => Boolean(getEmbeddingProvider()),
    rank: <T>(kind: RankingKind<T>) => kind.semantic(),
  },
];
export function availableStrategies(store: SearchCapabilities): SearchStrategy[] {
  return strategies.filter((s) => s.available(store)).map((s) => s.key);
}
export const RELATIVE_SCORE_PROMISE =
  "under `semantic` or `keyword` alone the shape is real, a ratio of similarities or of engine scores; under `hybrid`, or with two kinds fused, it is rank-made: a hit found by both rankings sits clearly above one found by one, then the numbers trail smoothly whatever the closeness. It shows where the ranking degrades and how steeply, never whether the best hit is good.";
