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
  "1.0 for the best hit; multiple hits can tie. Comparable only within this response, never confidence. Even an unrelated query can return a best hit. Tied scores can be ordered by available evidence and do not mean equal relevance.";
export const SEARCH_EVIDENCE_GUIDANCE =
  "Results are candidates, not verified answers. Each match has evidence: semanticSimilarity is a normalized similarity measurement from 0 to 1, not confidence; keywordMatch=true means normalized query terms matched that unit. Null means unknown or unmeasured, never false. Property keywordPropertyKeys lists keys whose values supply query terms, not fields each matching the entire query; null means complete attribution is unavailable. Keyword queries use plain words with all surviving terms required, not operators. Use short content terms and type/filter scope. Read entity values and get_document at returned passage coordinates before making claims; if the content does not support an answer, say so.";
