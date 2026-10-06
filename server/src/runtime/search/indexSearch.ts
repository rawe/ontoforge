/**
 * Search over search indices (spec §8): the search of every adapter that
 * stores them. One engine serves the index search (`searchByIndices`,
 * by index keys) and the default search (`searchThroughIndices`, the
 * `GET search` parameters mapped onto default and passage indices):
 *
 * 1. The indices: those requested, or all, among the ones the lens may
 *    search (`availableIndices`).
 * 2. Per index × representation of the mode, rank the entries of the
 *    active (ready) generation — semantic entries only of the embedding
 *    model in use. A generation still building contributes nothing. The
 *    exact filters and the lens's hidden relation and target types (and
 *    a `relations` choice) restrict the ranking itself; a relation entry
 *    the lens cannot see is skipped, never rebuilt.
 * 3. Per representation, merge the indices' entries into one ranking by
 *    their raw scores, and group it by entity — the best entry scores it
 *    and is kept as what matched. Hybrid fuses the semantic and keyword
 *    entity rankings by reciprocal rank (k = 60); a single mode keeps its
 *    scores (`core/searchQuery.ts`). An entity found by several indices of
 *    one mode counts once, never more.
 * 4. Each index's ranking first fetches `limit × 4` entries; if fewer than
 *    `limit` entities come out, the rankings not yet exhausted fetch once
 *    more, up to a fixed cap — never more.
 * 5. Project the entities through the lens and describe the match.
 *
 * `minScore` drops semantic entries below it — on the `(1 + cosine) / 2`
 * scale — before grouping, so it applies to an entity's best semantic
 * entry; keyword entries are never touched.
 *
 * The lens's catalog (`searchIndexCatalog`) lists the indices it may
 * search, projected through it, for clients and agents to choose from.
 */

import { getEmbeddingProvider } from "../../core/embedding.js";
import { NotFoundError, ValidationError } from "../../core/exceptions.js";
import type {
  FilterCondition,
  KeywordMatching,
  RankedSearchEntry,
  Row,
  RuntimeStore,
  SearchGenerationRecord,
  SearchIndexRecord,
  SearchIndexStore,
} from "../../core/ports.js";
import { documentField } from "../../core/searchComposition.js";
import { managedIndexDescription, type SearchRepresentation } from "../../core/searchIndex.js";
import { disabledIndexKeys, type SearchIndexState } from "../../core/searchPipeline.js";
import {
  availableIndices,
  fuseModes,
  mergeByScore,
  readsHiddenProperties,
  snippet,
  type FusedHit,
  type ModeRanking,
} from "../../core/searchQuery.js";
import {
  applyFieldProjection,
  ENTITY_NEIGHBOR_ALWAYS_FIELDS,
  filterEntityProperties,
} from "../readHelpers.js";
import { listSearchIndexStatuses } from "../indexing/status.js";
import { loadSchema, type LoadedSchema } from "../schemaCache.js";
import { relativeScore } from "./fusion.js";
import { resolveSearchFilters } from "./request.js";

export const SEARCH_MODES = ["semantic", "keyword", "hybrid"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

/** Entries a ranking first fetches per requested entity. */
const OVERFETCH_FACTOR = 4;

/** The most entries one ranking fetches. */
const ENTRY_FETCH_CAP = 1000;

/** What matched an entity: its best entry. */
export interface Matched {
  index: string;
  partKind: "self" | "relation" | "passage";
  relationType: string | null;
  relationId: string | null;
  /** The entity on the other end of a relation entry; its label is its
   * name property's value (null when empty or hidden by the lens). */
  target: { id: string; type: string; label: string | null } | null;
  /** At most 200 characters of the entry's text; empty when the index
   * reads properties the lens hides. */
  snippet: string;
  /** A passage's place in its document. */
  charOffset: number | null;
  charLength: number | null;
}

/** One index to rank, with the exact filters on its root type. */
export interface IndexTarget {
  index: SearchIndexRecord;
  conditions: FilterCondition[];
  /** Relation types whose relation entries of this index count, on top of
   * the request's `relations`; absent or null: no further restriction. */
  relations?: readonly string[] | null;
  /** Rank only these entities; absent or null: every entity. */
  entityIds?: readonly string[] | null;
}

/** One index's part in an entity's hit: the entry that represents it and
 * the measurements of that entry. */
export interface IndexMatch {
  index: SearchIndexRecord;
  entry: RankedSearchEntry;
  /** `(1 + cosine) / 2` of this entry, when the semantic ranking fetched
   * it; else null (unmeasured). */
  semanticSimilarity: number | null;
  /** The keyword score of this entry — distinct query words matched plus
   * the full-text rank as a fraction below one — when the keyword ranking
   * fetched it; else null. */
  keywordScore: number | null;
}

/** One entity of an engine ranking. */
export interface EngineHit {
  entityId: string;
  entityType: string;
  score: number;
  /** The entity's best entry in the mode it ranks best in. */
  matched: { index: SearchIndexRecord; entry: RankedSearchEntry };
  /** Per index that found the entity, the matched mode's order first. */
  indices: IndexMatch[];
}

export interface EngineRequest {
  targets: IndexTarget[];
  query: string;
  mode: SearchMode;
  matching: KeywordMatching;
  /** Relation types whose relation entries count; null: all the lens shows. */
  relations: string[] | null;
  minScore: number | null;
  limit: number;
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/** The indices the lens may search, in key order. */
export async function searchableIndices(
  loaded: LoadedSchema,
  indexStore: SearchIndexStore,
): Promise<SearchIndexRecord[]> {
  const [indices, settings] = await Promise.all([
    indexStore.listIndices(),
    indexStore.getSearchSettings(),
  ]);
  return availableIndices(
    indices,
    {
      scoped: loaded.searchIndexScope.scoped,
      exposedEntityTypes: new Set(Object.keys(loaded.scoped.entityTypes)),
      includedIndices: new Set(loaded.searchIndexScope.includedIndices),
    },
    disabledIndexKeys(settings),
  );
}

/** The search modes the server can run, in preference order — the first
 * is the default. */
export function availableModes(): SearchMode[] {
  return getEmbeddingProvider() === null ? ["keyword"] : ["hybrid", "keyword", "semantic"];
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/** One index of a lens's search catalog. */
export interface SearchIndexCatalogEntry {
  key: string;
  kind: SearchIndexRecord["kind"];
  name: string;
  /** A managed index's names only the fields the lens shows. */
  description: string;
  entityType: string;
  /** The root's fields the lens shows. */
  fields: string[];
  /** The relation groups the lens shows — a group whose relation type, or
   * the entity type on its other end, the lens hides is skipped at query
   * time and not listed. `label`: the group's, else the relation type's
   * display name. */
  relations: { relationType: string; direction: "outgoing" | "incoming"; label: string }[];
  /** The document an index reads passages of — null when it reads none,
   * or the lens hides it. */
  documentProperty: string | null;
  /** The representations the index has enabled that can rank now:
   * semantic only with an embedding provider. */
  modes: SearchRepresentation[];
  status: SearchIndexState;
}

/**
 * The indices the lens may search (`searchableIndices`: switched-off
 * managed ones never), each projected through the lens, with its build
 * state. Adapter without search indices -> disabled feature.
 */
export async function searchIndexCatalog(
  lensKey: string,
  store: RuntimeStore,
): Promise<SearchIndexCatalogEntry[]> {
  const indexStore = indexStoreOf(store);
  const loaded = await loadSchema(lensKey, store);
  const [indices, statuses] = await Promise.all([
    searchableIndices(loaded, indexStore),
    listSearchIndexStatuses(indexStore.ontologyKey),
  ]);
  const stateOf = new Map(statuses.map((status) => [status.key, status.state] as const));
  const semantic = getEmbeddingProvider() !== null;
  return indices.map((index) => {
    const { definition } = index;
    const root = loaded.scoped.entityTypes[definition.entityType]!;
    const relations = definition.relations.flatMap((group) => {
      const relationType = loaded.scoped.relationTypes[group.relationType];
      if (relationType === undefined) return [];
      const otherEnd =
        group.direction === "outgoing" ? relationType.toEntityTypeKey : relationType.fromEntityTypeKey;
      if (loaded.scoped.entityTypes[otherEnd] === undefined) return [];
      return [
        {
          relationType: group.relationType,
          direction: group.direction,
          label: group.label ?? relationType.displayName,
        },
      ];
    });
    const document = documentField(definition, loaded.full);
    const fields = definition.fields.filter((key) => key in root.properties);
    return {
      key: index.key,
      kind: index.kind,
      name: definition.name,
      // A managed description names the fields it reads: regenerated from
      // the ones the lens shows. A custom one is the designer's own text.
      description:
        index.kind === "custom"
          ? definition.description
          : managedIndexDescription(
              index.kind,
              root.displayName,
              fields.map((key) => root.properties[key]!.displayName),
            ),
      entityType: definition.entityType,
      fields,
      relations,
      documentProperty: document !== null && document in root.properties ? document : null,
      modes: (["semantic", "keyword"] as const).filter(
        (representation) => definition[representation].enabled && (representation === "keyword" || semantic),
      ),
      status: stateOf.get(index.key) ?? "stale",
    };
  });
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

interface LegSpec {
  target: IndexTarget;
  representation: SearchRepresentation;
  generation: SearchGenerationRecord;
}

interface FetchedLeg {
  entries: RankedSearchEntry[];
  /** Fetching more would add nothing: the ranking ran out (or past the
   * floor). */
  exhausted: boolean;
}

/** Rank entities over the targets' active generations (module comment,
 * steps 2–4). */
export async function rankThroughIndices(
  loaded: LoadedSchema,
  indexStore: SearchIndexStore,
  request: EngineRequest,
): Promise<EngineHit[]> {
  const provider = getEmbeddingProvider();
  const representations: SearchRepresentation[] =
    request.mode === "hybrid" ? ["semantic", "keyword"] : [request.mode];
  const ready = (await indexStore.listGenerations()).filter((g) => g.state === "ready");
  const specs: LegSpec[] = [];
  for (const target of request.targets) {
    for (const representation of representations) {
      if (!target.index.definition[representation].enabled) continue;
      const generation = ready.find(
        (g) =>
          g.searchIndexId === target.index.searchIndexId &&
          g.representation === representation &&
          (representation === "keyword" || g.modelId === provider?.modelId),
      );
      if (generation !== undefined) specs.push({ target, representation, generation });
    }
  }
  if (specs.length === 0) return [];

  let vector: number[] | undefined;
  if (specs.some((spec) => spec.representation === "semantic")) {
    const embedded = await provider!.embed(request.query);
    if (!embedded) throw new ValidationError("Failed to generate embedding for search query");
    vector = embedded;
  }

  // The lens's hidden relation and target types, and the caller's choice.
  const scoped = loaded.searchIndexScope.scoped;
  const lensRelations = scoped ? Object.keys(loaded.scoped.relationTypes) : null;
  const relationTypes =
    request.relations === null
      ? lensRelations
      : request.relations.filter((key) => lensRelations === null || lensRelations.includes(key));
  const targetTypes = scoped ? Object.keys(loaded.scoped.entityTypes) : null;

  const fetchLeg = async (spec: LegSpec, limit: number): Promise<FetchedLeg> => {
    const semantic = spec.representation === "semantic";
    const own = spec.target.relations ?? null;
    const raw = await indexStore.rankEntries({
      generationId: spec.generation.generationId,
      ...(semantic ? { vector } : { text: request.query, matching: request.matching }),
      conditions: spec.target.conditions,
      entityIds: spec.target.entityIds ?? null,
      relationTypes:
        own === null ? relationTypes : own.filter((key) => relationTypes === null || relationTypes.includes(key)),
      targetTypes,
      limit,
    });
    const floor = semantic ? request.minScore : null;
    const entries = floor === null ? raw : raw.filter((entry) => entry.score >= floor);
    const exhausted = raw.length < limit || (floor !== null && raw.at(-1)!.score < floor);
    return { entries, exhausted };
  };

  const first = Math.min(request.limit * OVERFETCH_FACTOR, ENTRY_FETCH_CAP);
  let fetched = await Promise.all(specs.map((spec) => fetchLeg(spec, first)));
  let modes = fuse(specs, fetched);
  if (modes.fused.length < request.limit && first < ENTRY_FETCH_CAP && fetched.some((f) => !f.exhausted)) {
    fetched = await Promise.all(
      specs.map((spec, i) => (fetched[i]!.exhausted ? fetched[i]! : fetchLeg(spec, ENTRY_FETCH_CAP))),
    );
    modes = fuse(specs, fetched);
  }
  return modes.fused.slice(0, request.limit).map((hit) => toEngineHit(hit, specs, modes));
}

/** An entry with the ranking (index × representation) it came from. */
type SpecEntry = RankedSearchEntry & { spec: number };

interface ModeRankings {
  rankings: ModeRanking<SpecEntry>[];
  fused: FusedHit<SpecEntry>[];
}

function fuse(specs: LegSpec[], fetched: FetchedLeg[]): ModeRankings {
  const rankings: ModeRanking<SpecEntry>[] = [];
  for (const representation of ["semantic", "keyword"] as const) {
    const lists = specs.flatMap((spec, i) =>
      spec.representation === representation
        ? [fetched[i]!.entries.map((entry) => ({ ...entry, spec: i }))]
        : [],
    );
    if (lists.length > 0) rankings.push({ representation, entries: mergeByScore(lists) });
  }
  return { rankings, fused: fuseModes(rankings) };
}

/** Same entry: same part of the same entity. */
function sameEntry(a: RankedSearchEntry, b: RankedSearchEntry): boolean {
  return a.partKind === b.partKind && a.groupNo === b.groupNo && a.partId === b.partId;
}

/** Without the ranking bookkeeping. */
function plain({ spec: _spec, ...entry }: SpecEntry): RankedSearchEntry {
  return entry;
}

function toEngineHit(
  hit: FusedHit<SpecEntry>,
  specs: LegSpec[],
  { rankings }: ModeRankings,
): EngineHit {
  const matchedSpec = specs[hit.matched.entry.spec]!;
  // The entity's entries per mode, the matched mode first; per index the
  // first of them — the best of the mode it ranks best in — represents it,
  // and is measured wherever a ranking fetched that very entry.
  const ordered = [...rankings].sort(
    (a, b) =>
      Number(b.representation === hit.matched.representation) -
      Number(a.representation === hit.matched.representation),
  );
  const own = ordered.map((ranking) => ({
    representation: ranking.representation,
    entries: ranking.entries.filter((entry) => entry.entityId === hit.entityId),
  }));
  const primaries = new Map<string, SpecEntry>();
  for (const { entries } of own) {
    for (const entry of entries) {
      const key = specs[entry.spec]!.target.index.key;
      if (!primaries.has(key)) primaries.set(key, entry);
    }
  }
  const indices: IndexMatch[] = [...primaries].map(([key, primary]) => {
    const measured = (representation: SearchRepresentation) =>
      own
        .find((mode) => mode.representation === representation)
        ?.entries.find(
          (entry) => specs[entry.spec]!.target.index.key === key && sameEntry(entry, primary),
        )?.score ?? null;
    return {
      index: specs[primary.spec]!.target.index,
      entry: plain(primary),
      semanticSimilarity: measured("semantic"),
      keywordScore: measured("keyword"),
    };
  });
  return {
    entityId: hit.entityId,
    entityType: matchedSpec.target.index.definition.entityType,
    score: hit.score,
    matched: { index: matchedSpec.target.index, entry: plain(hit.matched.entry) },
    indices,
  };
}

// ---------------------------------------------------------------------------
// Entities and matches
// ---------------------------------------------------------------------------

/** The hits' entities, read and projected through the lens, by id. An
 * entity gone since the ranking is missing. */
export async function readHitEntities(
  loaded: LoadedSchema,
  store: RuntimeStore,
  hits: EngineHit[],
  fields: string[] | null | undefined,
): Promise<Map<string, Row>> {
  const byType = new Map<string, string[]>();
  for (const hit of hits) byType.set(hit.entityType, [...(byType.get(hit.entityType) ?? []), hit.entityId]);
  const entities = new Map<string, Row>();
  for (const [type, ids] of byType) {
    const scopedType = loaded.scoped.entityTypes[type];
    const fullType = loaded.full.entityTypes[type];
    if (scopedType === undefined || fullType === undefined) continue;
    const rows = await store.getEntitiesByIds(ids, fullType.properties);
    for (const [id, row] of Object.entries(rows)) {
      const entity = filterEntityProperties({ ...row, _entityTypeKey: type }, scopedType, fields);
      entities.set(id, applyFieldProjection(entity, fields, ENTITY_NEIGHBOR_ALWAYS_FIELDS));
    }
  }
  return entities;
}

/** Describe what matched each hit (`Matched`), by entity id. */
export async function describeMatches(
  loaded: LoadedSchema,
  store: RuntimeStore,
  hits: EngineHit[],
): Promise<Map<string, Matched>> {
  const labels = await targetLabels(
    loaded,
    store,
    hits.map((hit) => hit.matched.entry),
  );
  const withheld = new Map<string, boolean>();
  const hidesText = (index: SearchIndexRecord) => {
    if (!withheld.has(index.key)) {
      withheld.set(index.key, readsHiddenProperties(index.definition, loaded.full, loaded.scoped));
    }
    return withheld.get(index.key)!;
  };
  const described = new Map<string, Matched>();
  for (const hit of hits) {
    const { index, entry } = hit.matched;
    described.set(hit.entityId, {
      index: index.key,
      partKind: entry.partKind,
      relationType: entry.relationType,
      relationId: entry.partKind === "relation" ? entry.partId : null,
      target:
        entry.targetId === null || entry.targetType === null
          ? null
          : {
              id: entry.targetId,
              type: entry.targetType,
              label: labels.get(entry.targetId) ?? null,
            },
      snippet: hidesText(index) ? "" : snippet(entry.text),
      charOffset: entry.partKind === "passage" ? entry.startChar : null,
      charLength: entry.partKind === "passage" ? entry.charLength : null,
    });
  }
  return described;
}

/** The name-property values of the target entities, by id — through the
 * lens: a hidden name property gives no label. */
async function targetLabels(
  loaded: LoadedSchema,
  store: RuntimeStore,
  entries: RankedSearchEntry[],
): Promise<Map<string, string>> {
  const byType = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.targetId === null || entry.targetType === null) continue;
    byType.set(entry.targetType, (byType.get(entry.targetType) ?? new Set()).add(entry.targetId));
  }
  const labels = new Map<string, string>();
  for (const [type, ids] of byType) {
    const nameProperty = loaded.scoped.entityTypes[type]?.nameProperty ?? null;
    const fullType = loaded.full.entityTypes[type];
    if (nameProperty === null || fullType === undefined) continue;
    const rows = await store.getEntitiesByIds([...ids], fullType.properties);
    for (const [id, row] of Object.entries(rows)) {
      const value = row[nameProperty];
      if (typeof value === "string" && value !== "") labels.set(id, value);
    }
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Index search
// ---------------------------------------------------------------------------

export interface IndexSearchRequest {
  /** Index keys; absent: every index the lens may search. */
  indices?: string[] | null;
  query: string;
  /** Absent: the first available mode (hybrid with an embedding provider). */
  mode?: SearchMode | null;
  /** Relation types whose relation entries count; absent: all. */
  relations?: string[] | null;
  /** Exact filters, as the entity list's `filter.*` keys. */
  filters?: Record<string, string>;
  /** Floor on the best semantic entry, `(1 + cosine) / 2`, 0..1. */
  minScore?: number | null;
  /** Entities, 1..100; default 10. */
  limit?: number;
  /** Project each entity to these properties (`_id`, `_entityTypeKey`
   * always kept); absent: every property the lens shows. */
  fields?: string[] | null;
}

export interface IndexSearchHit {
  entity: Row;
  /** Ratio to the best hit's score in this response; never confidence. */
  relativeScore: number;
  matched: Matched;
}

export interface IndexSearchResponse {
  query: string;
  mode: SearchMode;
  hits: IndexSearchHit[];
}

/** The search-index store behind a runtime store, or the disabled-feature
 * refusal on an adapter without search indices. */
export function indexStoreOf(store: RuntimeStore): SearchIndexStore {
  if (store.searchIndices === undefined) {
    throw new ValidationError("Search indices are not supported by the active storage adapter", {
      code: "FEATURE_DISABLED",
    });
  }
  return store.searchIndices();
}

/**
 * Search entities through chosen indices. Unknown index keys -> not found;
 * an index the lens may not search, an unknown relation type, an invalid
 * dimension -> validation error (collected, by field); a mode that needs
 * an embedding provider without one -> disabled feature.
 */
export async function searchByIndices(
  lensKey: string,
  request: IndexSearchRequest,
  store: RuntimeStore,
): Promise<IndexSearchResponse> {
  const indexStore = indexStoreOf(store);
  const loaded = await loadSchema(lensKey, store);
  const errors: Record<string, string> = {};

  if (!request.query?.trim()) errors.query = "Required non-empty query";
  const limit = request.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    errors.limit = "Expected integer from 1 to 100";
  }
  const modes = availableModes();
  const mode = request.mode ?? modes[0]!;
  if (!(SEARCH_MODES as readonly string[]).includes(mode)) errors.mode = "Expected semantic, keyword or hybrid";
  const minScore = request.minScore ?? null;
  if (minScore !== null) {
    if (!(typeof minScore === "number" && minScore >= 0 && minScore <= 1)) {
      errors.minScore = "Expected number from 0 to 1";
    } else if (mode === "keyword") {
      errors.minScore = "minScore requires a mode that ranks semantically";
    }
  }

  const all = await indexStore.listIndices();
  const searchable = await searchableIndices(loaded, indexStore);
  let selected = searchable;
  if (request.indices !== undefined && request.indices !== null) {
    if (request.indices.length === 0) errors.indices = "Name at least one index, or omit indices";
    const unknown = request.indices.filter((key) => !all.some((index) => index.key === key));
    if (unknown.length > 0) {
      throw new NotFoundError(`Search index '${unknown[0]}' not found`);
    }
    request.indices.forEach((key, i) => {
      if (!searchable.some((index) => index.key === key)) {
        errors[`indices.${i}`] = `Search index '${key}' is not available in this lens`;
      }
    });
    selected = searchable.filter((index) => request.indices!.includes(index.key));
  }

  const relations = request.relations ?? null;
  relations?.forEach((key, i) => {
    if (loaded.scoped.relationTypes[key] === undefined) {
      errors[`relations.${i}`] = `Relation type '${key}' not found`;
    }
  });

  const rootTypes = [...new Set(selected.map((index) => index.definition.entityType))]
    .map((key) => [key, loaded.scoped.entityTypes[key]!] as [string, (typeof loaded.scoped.entityTypes)[string]])
    .filter(([, def]) => def !== undefined);
  const eligible = resolveSearchFilters(request.filters ?? {}, rootTypes, false, loaded, store, errors);
  if (Object.keys(errors).length > 0) {
    throw new ValidationError(Object.values(errors).join("; "), { fields: errors });
  }
  if (!modes.includes(mode)) {
    throw new ValidationError(
      `Search mode unavailable. Available modes: ${modes.join(", ")}`,
      { code: "FEATURE_DISABLED" },
    );
  }

  const conditions = new Map(eligible.map((type) => [type.entityTypeKey, type.conditions] as const));
  const hits = await rankThroughIndices(loaded, indexStore, {
    targets: selected
      .filter((index) => conditions.has(index.definition.entityType))
      .map((index) => ({ index, conditions: conditions.get(index.definition.entityType)! })),
    query: request.query,
    mode,
    matching: "any",
    relations,
    minScore,
    limit,
  });
  const entities = await readHitEntities(loaded, store, hits, request.fields);
  const present = hits.filter((hit) => entities.has(hit.entityId));
  const matched = await describeMatches(loaded, store, present);
  return {
    query: request.query,
    mode,
    hits: present.map((hit) => ({
      entity: entities.get(hit.entityId)!,
      relativeScore: relativeScore(hit.score, present[0]!.score),
      matched: matched.get(hit.entityId)!,
    })),
  };
}
