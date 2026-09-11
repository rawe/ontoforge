import { getEmbeddingProvider } from "../../core/embedding.js";
import { ValidationError } from "../../core/exceptions.js";
import type { Row, RuntimeStore } from "../../core/ports.js";
import {
  applyFieldProjection,
  filterEntityProperties,
  ENTITY_ALWAYS_FIELDS,
  ENTITY_NEIGHBOR_ALWAYS_FIELDS,
} from "../readHelpers.js";
import { validateRequest, type SearchRequest, type SearchKind } from "./request.js";
import { strategies, availableStrategies, type SearchStrategy } from "./strategies.js";
import { propertyKind } from "./property.js";
import { documentKind, collapsePassages } from "./document.js";
import {
  emptyEvidence, fuse, refineTies, relativeScore, type Ranked, type SearchEvidence,
} from "./fusion.js";
export type { SearchRequest } from "./request.js";
export type { SearchEvidence } from "./fusion.js";
export type SearchMatch =
  | { kind: "properties"; evidence: SearchEvidence & { keywordPropertyKeys: string[] | null } }
  | {
      kind: "document";
      propertyKey: string;
      charOffset: number;
      charLength: number;
      evidence: SearchEvidence;
    };
export interface SearchHit {
  entity: Row;
  /** Ratio to the best score in this response; see RELATIVE_SCORE_PROMISE. Never confidence. */
  relativeScore: number;
  matches: SearchMatch[];
}
export interface SearchResponse {
  query: string;
  type: string | null;
  in: SearchKind[];
  strategy: SearchStrategy;
  filter: Record<string, string>;
  hits: SearchHit[];
}
export async function search(
  lensKey: string,
  request: SearchRequest,
  store: RuntimeStore,
): Promise<SearchResponse> {
  const { loaded, kinds, type, limit, filter, searchedTypes, searchedProperties } =
    await validateRequest(lensKey, request, store);
  const available = availableStrategies(store);
  const strategy = strategies.find((s) => s.key === (request.strategy ?? available[0]));
  if (!strategy || !available.includes(strategy.key))
    throw new ValidationError(
      `Search strategy unavailable. Available strategies: ${available.join(", ") || "none"}`,
      { code: "FEATURE_DISABLED" },
    );
  const embedding =
    strategy.key === "keyword" ? [] : await getEmbeddingProvider()!.embed(request.query);
  if (!embedding) throw new ValidationError("Failed to generate embedding for search query");
  type Hit = { entity: Row; matches: SearchMatch[] };
  const rankings: Ranked<Hit>[][] = [];
  if (kinds.includes("properties"))
    rankings.push(
      (
        await strategy.rank(propertyKind(store, searchedTypes, embedding, limit, request.query))
      ).map((r) => ({
        key: r.key,
        score: r.score,
        value: {
          entity: r.value,
          matches: [
            {
              kind: "properties",
              evidence: {
                ...emptyEvidence(),
                ...r.evidence,
                keywordPropertyKeys: r.evidence?.keywordPropertyKeys ?? null,
              },
            },
          ],
        },
      })),
    );
  if (kinds.includes("document")) {
    // Exhaust the passage ranking so a second document property cannot be hidden
    // behind many passages of the first. Collapse and the entity limit live here.
    let budget = limit * 5;
    let collapsed: ReturnType<typeof collapsePassages> = [];
    while (searchedProperties.length) {
      const passages = await strategy.rank(
        documentKind(store, searchedProperties, embedding, budget, request.query),
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
  let ranked =
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
        .filter((value): value is number => value !== null && Number.isFinite(value));
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
    const exposedProperties = loaded.scoped.entityTypes[typeKey]!.properties;
    // A partial list would claim complete attribution. Projection is not lens permission.
    for (const match of r.value.matches) {
      if (
        match.kind === "properties" &&
        match.evidence.keywordPropertyKeys?.some(
          (key) => exposedProperties[key]?.dataType !== "string",
        )
      )
        match.evidence.keywordPropertyKeys = null;
    }
    const entity = filterEntityProperties(
      r.value.entity,
      loaded.scoped.entityTypes[typeKey]!,
      request.fields,
    );
    if (type !== null) delete entity._entityTypeKey;
    return {
      entity: applyFieldProjection(
        entity,
        request.fields,
        type === null ? ENTITY_NEIGHBOR_ALWAYS_FIELDS : ENTITY_ALWAYS_FIELDS,
      ),
      relativeScore: relativeScore(r.score, ranked[0]!.score),
      matches: r.value.matches.sort(
        (a, b) => Number(b.kind === "properties") - Number(a.kind === "properties"),
      ),
    };
  });
  return { query: request.query, type, in: kinds, strategy: strategy.key, filter, hits };
}
