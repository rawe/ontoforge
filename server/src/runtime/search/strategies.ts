import { getEmbeddingProvider } from "../../core/embedding.js";
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
export interface SearchCapabilities {
  supportsKeywordRanking(): boolean;
}
interface Strategy {
  key: SearchStrategy;
  available(store: SearchCapabilities): boolean;
}
/** Fixed preference order; every listed strategy has requirements. */
export const strategies: Strategy[] = [
  {
    key: "hybrid",
    available: (store: SearchCapabilities) =>
      Boolean(getEmbeddingProvider()) && store.supportsKeywordRanking(),
  },
  {
    key: "keyword",
    available: (store: SearchCapabilities) => store.supportsKeywordRanking(),
  },
  {
    key: "keyword-any",
    available: (store: SearchCapabilities) => store.supportsKeywordRanking(),
  },
  {
    key: "keyword-all",
    available: (store: SearchCapabilities) => store.supportsKeywordRanking(),
  },
  {
    key: "semantic",
    available: () => Boolean(getEmbeddingProvider()),
  },
];
export function availableStrategies(store: SearchCapabilities): SearchStrategy[] {
  return strategies.filter((s) => s.available(store)).map((s) => s.key);
}
/** The fixed similarity floor the MCP and agent search tools apply. The caller cannot set
 * it; the envelope echoes it as `minSimilarity`. */
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
