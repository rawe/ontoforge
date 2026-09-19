import { getEmbeddingProvider } from "../../core/embedding.js";
import type { KeywordMatching } from "../../core/ports.js";
import {
  fuse, type FusionScore, type KeywordScore, type Ranked, type RankingScore, type SemanticSimilarity,
} from "./fusion.js";
export const SEARCH_STRATEGIES = [
  "semantic", "keyword", "keyword-any", "keyword-all", "hybrid",
] as const;
export type SearchStrategy = (typeof SEARCH_STRATEGIES)[number];
/** The strategies whose ranking has no semantic source; a similarity floor has nothing
 * to apply to under them. */
const KEYWORD_ONLY: ReadonlySet<SearchStrategy> = new Set(["keyword", "keyword-any", "keyword-all"]);
export function ranksSemantically(strategy: SearchStrategy): boolean {
  return !KEYWORD_ONLY.has(strategy);
}
/** The source rankings of one search kind, each produced by one retrieval method and
 * ordered by its own score kind. */
export interface RankingKind<T> {
  semantic(): Promise<Ranked<T, SemanticSimilarity>[]>;
  keyword(matching: KeywordMatching): Promise<Ranked<T, KeywordScore>[]>;
}
export interface SearchCapabilities {
  supportsKeywordRanking(): boolean;
}
/** A strategy's ranking holds one score kind, which one is known only at runtime. */
interface Strategy {
  key: SearchStrategy;
  available(store: SearchCapabilities): boolean;
  rank<T>(kind: RankingKind<T>): Promise<Ranked<T, RankingScore>[]>;
}
/** Fixed preference order; every listed strategy has an implementation and requirements.
 * Each strategy uses one retrieval method directly or fuses several by rank. */
export const strategies: Strategy[] = [
  {
    key: "hybrid",
    available: (store: SearchCapabilities) =>
      Boolean(getEmbeddingProvider()) && store.supportsKeywordRanking(),
    rank: async <T>(kind: RankingKind<T>): Promise<Ranked<T, FusionScore>[]> =>
      fuse(await Promise.all([kind.semantic(), kind.keyword("any")])),
  },
  {
    // The default keyword matching, today any-term; `hybrid` fuses the same one.
    // `keyword-any` and `keyword-all` each fix one method and never change meaning.
    key: "keyword",
    available: (store: SearchCapabilities) => store.supportsKeywordRanking(),
    rank: <T>(kind: RankingKind<T>) => kind.keyword("any"),
  },
  {
    key: "keyword-any",
    available: (store: SearchCapabilities) => store.supportsKeywordRanking(),
    rank: <T>(kind: RankingKind<T>) => kind.keyword("any"),
  },
  {
    key: "keyword-all",
    available: (store: SearchCapabilities) => store.supportsKeywordRanking(),
    rank: <T>(kind: RankingKind<T>) => kind.keyword("all"),
  },
  {
    key: "semantic",
    available: () => Boolean(getEmbeddingProvider()),
    rank: <T>(kind: RankingKind<T>) => kind.semantic(),
  },
];
export function availableStrategies(store: SearchCapabilities): SearchStrategy[] {
  return strategies.filter((s) => s.available(store)).map((s) => s.key);
}
/** The fixed similarity floor the MCP and agent search tools apply, hidden from the
 * caller like the strategy itself. */
export const TOOL_MIN_SIMILARITY = 0.75;
/** The floor the tools pass: the constant when the default strategy ranks semantically,
 * null under a keyword default, where a floor would be rejected. */
export function toolMinSimilarity(store: SearchCapabilities): number | null {
  const fallback = availableStrategies(store)[0];
  return fallback && ranksSemantically(fallback) ? TOOL_MIN_SIMILARITY : null;
}
export const TOOL_MIN_SIMILARITY_GUIDANCE =
  "Semantic candidates below a fixed similarity floor are omitted; the applied floor is echoed as minSimilarity in the envelope (null when the server ranks by keyword only).";
export const RELATIVE_SCORE_PROMISE =
  "1.0 for the best hit; multiple hits can tie. Comparable only within this response, never confidence. Even an unrelated query can return a best hit. Tied scores can be ordered by available evidence and do not mean equal relevance.";
export const SEARCH_EVIDENCE_GUIDANCE =
  "Results are candidates, not verified answers. Each match has evidence: semanticSimilarity is a normalized similarity measurement from 0 to 1, not confidence; keywordMatch=true means query terms matched that unit; keywordScore is then the adapter's native full-text ranking measurement, unbounded, comparable neither to semanticSimilarity nor across responses, for inspection only. Null means unknown or unmeasured, never false. Property keywordPropertyKeys lists keys whose values supply query terms, not fields each matching the entire query; null means complete attribution is unavailable. Keyword queries use plain words, not operators; a hit need not carry every query term. Use short content terms and type/filter scope. Read entity values and get_document at returned passage coordinates before making claims; if the content does not support an answer, say so.";
