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
/** The keyword matching `keyword` and `hybrid` use, always the same one; `keyword-any`
 * and `keyword-all` each fix their own and never follow it. */
const DEFAULT_KEYWORD_MATCHING: KeywordMatching = "any";
/** Fixed preference order; every listed strategy has an implementation and requirements.
 * Each strategy uses one retrieval method directly or fuses several by rank. */
export const strategies: Strategy[] = [
  {
    key: "hybrid",
    available: (store: SearchCapabilities) =>
      Boolean(getEmbeddingProvider()) && store.supportsKeywordRanking(),
    rank: async <T>(kind: RankingKind<T>): Promise<Ranked<T, FusionScore>[]> =>
      fuse(await Promise.all([kind.semantic(), kind.keyword(DEFAULT_KEYWORD_MATCHING)])),
  },
  {
    key: "keyword",
    available: (store: SearchCapabilities) => store.supportsKeywordRanking(),
    rank: <T>(kind: RankingKind<T>) => kind.keyword(DEFAULT_KEYWORD_MATCHING),
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
const CANDIDATES_NOT_ANSWERS = "Results are candidates, not verified answers.";
const KEYWORD_QUERY_GUIDANCE =
  "Keyword queries use plain words, not operators; a hit need not carry every query term.";
const VERIFY_BEFORE_CLAIMS =
  "if the content does not support an answer, say so.";
/** The default search tools' guidance: their hits carry per-match evidence. */
export const SEARCH_EVIDENCE_GUIDANCE =
  `${CANDIDATES_NOT_ANSWERS} Each match has evidence: semanticSimilarity is a normalized similarity from 0 to 1, not confidence; keywordMatch=true means query terms matched that unit; keywordScore is then the distinct query words matched plus the full-text rank as a fraction below one, comparable neither to semanticSimilarity nor across responses, for inspection only. Null means unknown or unmeasured, never false. ${KEYWORD_QUERY_GUIDANCE} Use short content terms and type/filter scope. Read entity values and get_document at returned passage coordinates before making claims; ${VERIFY_BEFORE_CLAIMS}`;
/** The index search tool's guidance: its hits carry `matched`, no evidence. */
export const INDEX_SEARCH_GUIDANCE =
  `${CANDIDATES_NOT_ANSWERS} ${KEYWORD_QUERY_GUIDANCE} Use short content terms and index/filter scope. A relation match shows what the hit is connected to, not that the hit answers the question. Read entity values, and get_document at a passage's coordinates, before making claims; ${VERIFY_BEFORE_CLAIMS}`;
