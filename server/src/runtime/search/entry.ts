import { getEmbeddingProvider } from "../../core/embedding.js";
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
  applyFieldProjection,
  filterEntityProperties,
  ENTITY_NEIGHBOR_ALWAYS_FIELDS,
} from "../readHelpers.js";
import {
  describeMatches,
  rankThroughIndices,
  readHitEntities,
  searchableIndices,
  type IndexTarget,
  type Matched,
  type SearchMode,
} from "./indexSearch.js";
import { validateRequest, type SearchRequest, type SearchKind } from "./request.js";
import {
  strategies, availableStrategies, ranksSemantically, type RankingKind, type SearchStrategy,
} from "./strategies.js";
import { propertyKind } from "./property.js";
import { documentKind, collapsePassages } from "./document.js";
import {
  emptyEvidence, fuse, refineTies, relativeScore,
  type KeywordScore, type Ranked, type RankingScore, type SearchEvidence, type SemanticSimilarity,
} from "./fusion.js";
export type { SearchRequest } from "./request.js";
export type { SearchEvidence } from "./fusion.js";
/** A match's evidence on the wire: the measurements, without property
 * attribution. */
export type MatchEvidence = Pick<SearchEvidence, "semanticSimilarity" | "keywordMatch" | "keywordScore">;
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
  /** What matched the entity best — on adapters that store search indices. */
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
/** How many candidates per requested hit a ranking fetches before it is fused or
 * collapsed and cut to the limit. */
const CANDIDATE_FACTOR = 5;
/** The floor drops semantic candidates below it before any fusion, above the storage
 * port; keyword rankings are never touched. A semantic row's score is its measured
 * similarity, so a floored page is short exactly when the ranking is exhausted. */
function floored<T>(kind: RankingKind<T>, minSimilarity: number | null): RankingKind<T> {
  if (minSimilarity === null) return kind;
  return {
    ...kind,
    semantic: async () => (await kind.semantic()).filter((r) => r.score >= minSimilarity),
  };
}
/** The wire form of a match's evidence. */
function wireEvidence(evidence: SearchEvidence): MatchEvidence {
  return {
    semanticSimilarity: evidence.semanticSimilarity,
    keywordMatch: evidence.keywordMatch,
    keywordScore: evidence.keywordScore,
  };
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
 * Ranked search. Requests are validated and a strategy chosen alike on
 * every adapter; an adapter that stores search indices then answers from
 * them (`searchThroughIndices`), any other from its own rankings.
 */
export async function search(
  lensKey: string,
  request: SearchRequest,
  store: RuntimeStore,
): Promise<SearchResponse> {
  const validated = await validateRequest(lensKey, request, store);
  const { loaded, kinds, type, limit, minSimilarity, filter, searchedTypes, searchedProperties } =
    validated;
  const available = availableStrategies(store);
  const strategy = strategies.find((s) => s.key === (request.strategy ?? available[0]));
  if (!strategy || !available.includes(strategy.key))
    throw new ValidationError(
      `Search strategy unavailable. Available strategies: ${available.join(", ") || "none"}`,
      { code: "FEATURE_DISABLED" },
    );
  if (store.searchIndices !== undefined)
    return searchThroughIndices(store.searchIndices(), store, request, validated, strategy.key);
  const embedding = ranksSemantically(strategy.key)
    ? await getEmbeddingProvider()!.embed(request.query)
    : [];
  if (!embedding) throw new ValidationError("Failed to generate embedding for search query");
  type InternalMatch =
    | { kind: "properties"; evidence: SearchEvidence }
    | Extract<SearchMatch, { kind: "document" }>;
  type Hit = { entity: Row; matches: InternalMatch[] };
  // The strategy is chosen at runtime, so a ranking's score kind is one of the three here.
  const rankings: Ranked<Hit, RankingScore>[][] = [];
  // Hybrid fuses two source rankings by rank. Each source fetches more candidates than the
  // limit, so an entity's fused score does not depend on where a short source page ended.
  const propertyCandidates = strategy.key === "hybrid" ? limit * CANDIDATE_FACTOR : limit;
  if (kinds.includes("properties"))
    rankings.push(
      (
        await strategy.rank(
          floored(
            propertyKind(store, searchedTypes, embedding, propertyCandidates, request.query),
            minSimilarity,
          ),
        )
      ).slice(0, limit).map((r) => ({
        key: r.key,
        score: r.score,
        value: {
          entity: r.value,
          matches: [
            {
              kind: "properties",
              evidence: { ...emptyEvidence(), ...r.evidence },
            },
          ],
        },
      })),
    );
  if (kinds.includes("document")) {
    // Exhaust the passage ranking so a second document property cannot be hidden
    // behind many passages of the first. Collapse and the entity limit live here.
    let budget = limit * CANDIDATE_FACTOR;
    let collapsed: ReturnType<typeof collapsePassages> = [];
    while (searchedProperties.length) {
      const passages = await strategy.rank(
        floored(
          documentKind(store, searchedProperties, embedding, budget, request.query),
          minSimilarity,
        ),
      );
      collapsed = collapsePassages(passages);
      if (passages.length < budget) break;
      budget *= 2;
    }
    rankings.push(
      collapsed.map((r) => ({
        ...r,
        value: {
          entity: { _id: r.key, _entityTypeKey: r.value.type },
          matches: r.value.matches,
        },
      })),
    );
  }
  const useBestKind = rankings.length > 1 && searchedTypes.length > 1;
  let ranked: Ranked<Hit, RankingScore>[] =
    rankings.length === 1
      ? rankings[0]!
      : fuse(
          rankings,
          (a, b) => ({
            entity: a.matches.some((m) => m.kind === "properties") ? a.entity : b.entity,
            matches: [...a.matches, ...b.matches],
          }),
          useBestKind ? "max" : "sum",
        );
  if (useBestKind) {
    ranked = refineTies(ranked, (hit) => {
      const measurements = hit.matches
        .map((match) => match.evidence.semanticSimilarity)
        .filter((value): value is SemanticSimilarity => value !== null && Number.isFinite(value));
      return measurements.length ? Math.max(...measurements) : null;
    });
  }
  ranked = ranked.slice(0, limit);
  // Retrieve only final document-only hits. Keeping all collapsed candidates until
  // fusion preserves a property hit's passages even below the document page cutoff.
  const documentOnly = ranked.filter((r) => !r.value.matches.some((m) => m.kind === "properties"));
  const retrieved: Record<string, Row> = {};
  for (const t of searchedTypes) {
    const ids = documentOnly
      .filter((r) => r.value.entity._entityTypeKey === t.entityTypeKey)
      .map((r) => r.key);
    if (ids.length) Object.assign(retrieved, await store.getEntitiesByIds(ids, t.propertyDefs));
  }
  ranked = ranked.filter((r) => {
    if (r.value.matches.some((m) => m.kind === "properties")) return true;
    if (!retrieved[r.key]) return false;
    r.value.entity = retrieved[r.key]!;
    return true;
  });
  const hits = ranked.map((r) => {
    const typeKey = String(r.value.entity._entityTypeKey ?? type);
    const entity = filterEntityProperties(
      { ...r.value.entity, _entityTypeKey: typeKey },
      loaded.scoped.entityTypes[typeKey]!,
      request.fields,
    );
    return {
      entity: applyFieldProjection(entity, request.fields, ENTITY_NEIGHBOR_ALWAYS_FIELDS),
      relativeScore: relativeScore(r.score, ranked[0]!.score),
      matches: r.value.matches
        .sort((a, b) => Number(b.kind === "properties") - Number(a.kind === "properties"))
        .map((match): SearchMatch => ({ ...match, evidence: wireEvidence(match.evidence) })),
    };
  });
  return {
    query: request.query, type, in: kinds, strategy: strategy.key, minSimilarity, filter, hits,
  };
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
