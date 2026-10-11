import { ValidationError } from "../../core/exceptions.js";
import type {
  FilterCondition,
  KeywordMatching,
  Row,
  RuntimeStore,
  SearchIndexStore,
} from "../../core/ports.js";
import { DEFAULT_INDEX_SUFFIX, managedIndexKey } from "../../core/searchIndex.js";
import {
  describeMatches,
  indexStoreOf,
  rankThroughIndices,
  readHitEntities,
  searchableIndices,
  type IndexTarget,
  type Matched,
  type SearchMode,
} from "./indexSearch.js";
import { validateRequest, type SearchRequest, type SearchKind } from "./request.js";
import { strategies, availableStrategies, type SearchStrategy } from "./strategies.js";
import {
  relativeScore, type KeywordScore, type SearchEvidence, type SemanticSimilarity,
} from "./fusion.js";
export type { SearchRequest } from "./request.js";
export type { SearchEvidence } from "./fusion.js";
/** A match's evidence on the wire: the measurements. */
export type MatchEvidence = SearchEvidence;
export type SearchMatch =
  | { kind: "properties"; evidence: MatchEvidence }
  | {
      kind: "document";
      propertyKey: string;
      charOffset: number;
      charLength: number;
      evidence: MatchEvidence;
    };
export interface SearchHit {
  entity: Row;
  /** Ratio to the best score in this response; see RELATIVE_SCORE_PROMISE. Never confidence. */
  relativeScore: number;
  matches: SearchMatch[];
  /** What matched the entity best. */
  matched?: Matched;
}
export interface SearchResponse {
  query: string;
  type: string | null;
  in: SearchKind[];
  strategy: SearchStrategy;
  /** The applied similarity floor, or null when the caller set none. */
  minSimilarity: number | null;
  filter: Record<string, string>;
  hits: SearchHit[];
}
/** The engine mode and keyword matching a strategy maps to. */
const STRATEGY_MODES: Record<SearchStrategy, { mode: SearchMode; matching: KeywordMatching }> = {
  semantic: { mode: "semantic", matching: "any" },
  keyword: { mode: "keyword", matching: "any" },
  "keyword-any": { mode: "keyword", matching: "any" },
  "keyword-all": { mode: "keyword", matching: "all" },
  hybrid: { mode: "hybrid", matching: "any" },
};
/**
 * Ranked search: the request is validated and a strategy chosen, then the
 * search indices answer it (`searchThroughIndices`).
 */
export async function search(
  lensKey: string,
  request: SearchRequest,
  store: RuntimeStore,
): Promise<SearchResponse> {
  const validated = await validateRequest(lensKey, request, store);
  const available = availableStrategies(store);
  const strategy = strategies.find((s) => s.key === (request.strategy ?? available[0]));
  if (!strategy || !available.includes(strategy.key))
    throw new ValidationError(
      `Search strategy unavailable. Available strategies: ${available.join(", ") || "none"}`,
      { code: "FEATURE_DISABLED" },
    );
  return searchThroughIndices(indexStoreOf(store), store, request, validated, strategy.key);
}

/**
 * Default search through search indices: properties search the default
 * index of each searched type, documents the passage index of each
 * searched document property — those the lens may search. The engine
 * (`indexSearch.ts`) ranks; every index that found an entity contributes
 * one match (its best entry: the entity's own text, or one passage), and
 * the best of them is the hit's `matched`.
 */
async function searchThroughIndices(
  indexStore: SearchIndexStore,
  store: RuntimeStore,
  request: SearchRequest,
  validated: Awaited<ReturnType<typeof validateRequest>>,
  strategy: SearchStrategy,
): Promise<SearchResponse> {
  const { loaded, kinds, type, limit, minSimilarity, filter, searchedTypes, searchedProperties } =
    validated;
  const searchable = new Map(
    (await searchableIndices(loaded, indexStore)).map((index) => [index.key, index] as const),
  );
  const targets: IndexTarget[] = [];
  const target = (key: string, conditions: FilterCondition[]) => {
    const index = searchable.get(key);
    if (index !== undefined) targets.push({ index, conditions });
  };
  if (kinds.includes("properties"))
    for (const t of searchedTypes)
      target(managedIndexKey(t.entityTypeKey, DEFAULT_INDEX_SUFFIX), t.conditions);
  if (kinds.includes("document"))
    for (const p of searchedProperties)
      target(managedIndexKey(p.entityTypeKey, p.propertyKey), p.conditions);

  const ranked = await rankThroughIndices(loaded, indexStore, {
    targets,
    query: request.query,
    ...STRATEGY_MODES[strategy],
    relations: null,
    minScore: minSimilarity,
    limit,
  });
  const entities = await readHitEntities(loaded, store, ranked, request.fields);
  const present = ranked.filter((hit) => entities.has(hit.entityId));
  const matched = await describeMatches(loaded, store, present);
  const hits = present.map((hit): SearchHit => {
    const matches: SearchMatch[] = [];
    for (const { index, entry, semanticSimilarity, keywordScore } of hit.indices) {
      const evidence: MatchEvidence = {
        semanticSimilarity: semanticSimilarity as SemanticSimilarity | null,
        keywordMatch: keywordScore === null ? null : true,
        keywordScore: keywordScore as KeywordScore | null,
      };
      if (index.kind === "default") matches.push({ kind: "properties", evidence });
      else if (entry.partKind === "passage")
        matches.push({
          kind: "document",
          propertyKey: index.definition.fields[0]!,
          charOffset: entry.startChar ?? 0,
          charLength: entry.charLength ?? 0,
          evidence,
        });
    }
    matches.sort((a, b) => Number(b.kind === "properties") - Number(a.kind === "properties"));
    return {
      entity: entities.get(hit.entityId)!,
      relativeScore: relativeScore(hit.score, present[0]!.score),
      matches,
      matched: matched.get(hit.entityId)!,
    };
  });
  return { query: request.query, type, in: kinds, strategy, minSimilarity, filter, hits };
}
