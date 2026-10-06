/**
 * Retrieval of a retriever agent's plan: each sub-query searches its
 * indices through the search engine (`runtime/search/indexSearch.ts`) —
 * in process, never over HTTP — and the sub-queries' rankings are fused
 * per entity by reciprocal rank (k = 60). An entity found by several
 * sub-queries keeps what matched in each; that, with its answer fields,
 * is the evidence the answer model gets.
 *
 * Filters and previous-result references restrict a sub-query to entity
 * ids, resolved here from the instance data: the entities on the far end
 * of the filter's path whose field equals the value (normalized compare,
 * as `sameValue`), walked back to the result type. A sub-query without a
 * query lists the restricted entities instead of searching. Semantic
 * matches below the agent's threshold never count (A5: the cosine
 * threshold `t` is the search's `(1 + t) / 2` floor).
 */

import type { Row, RuntimeStore, SearchIndexRecord, SearchIndexStore } from "../../core/ports.js";
import {
  similarityFloor,
  type RetrieverAgentConfig,
  type RetrieverAgentFilter,
  type FilterHop,
} from "../../core/retrieverAgent.js";
import { readsHiddenProperties, RRF_K } from "../../core/searchQuery.js";
import { filterEntityProperties } from "../readHelpers.js";
import type { LoadedSchema } from "../schemaCache.js";
import { describeMatches, rankThroughIndices, type EngineHit, type Matched } from "../search/indexSearch.js";
import { filterCondition, relationName, type AgentLens } from "./config.js";
import { sameValue, type Plan, type Previous, type SubQuery } from "./plan.js";

/** Entities one search of a sub-query ranks. */
export const SUB_QUERY_LIMIT = 30;

/** Most entities a query-less sub-query lists. */
export const LIST_LIMIT = 100;

/** Most entities one filter (or reference) step keeps. */
export const MAX_FILTER_MATCHES = 1000;

/** Characters of the evidence passed to the answer model. */
export const CONTEXT_CHARACTERS = 8000;

/** Rows read per page while resolving filters. */
const PAGE = 500;

/** Everything retrieval reads through. */
export interface RetrievalScope {
  config: RetrieverAgentConfig;
  lens: AgentLens;
  loaded: LoadedSchema;
  store: RuntimeStore;
  indexStore: SearchIndexStore;
  /** The indices the lens may search. */
  records: SearchIndexRecord[];
  signal: AbortSignal;
}

/** What one sub-query found of an entity. */
export interface SubQueryMatch {
  subQuery: number;
  /** Null for a listed (not searched) entity. */
  matched: Matched | null;
  /** The matched entry's text, cut to the answer-field length; null when
   * listed or when the index reads properties the lens hides. */
  text: string | null;
  /** The sub-query's exact filters the entity satisfies, in plain words
   * (`filterCondition`): "lives in City Name: Berlin". */
  filters: string[];
}

export interface RetrievedItem {
  entityId: string;
  entityType: string;
  label: string | null;
  /** The agent's answer fields of the entity's type, cut to length. */
  fields: Row;
  matches: SubQueryMatch[];
}

export interface Retrieval {
  /** Fused, best first. */
  items: RetrievedItem[];
  limitations: string[];
  searchCalls: number;
  /** Milliseconds spent in search calls. */
  searchMs: number;
}

/** One sub-query's ranking before the entities are read. */
interface Ranked {
  entityId: string;
  entityType: string;
  hit: EngineHit | null;
}

// ---------------------------------------------------------------------------
// Restrictions: filters and previous results as entity ids
// ---------------------------------------------------------------------------

/** The types a path passes through, its start first. */
function pathTypes(loaded: LoadedSchema, start: string, path: readonly FilterHop[]): string[] {
  const types = [start];
  for (const hop of path) {
    const relation = loaded.full.relationTypes[hop.relationTypeKey]!;
    types.push(hop.direction === "outgoing" ? relation.toEntityTypeKey : relation.fromEntityTypeKey);
  }
  return types;
}

/** Keep at most `MAX_FILTER_MATCHES`, noting a cut. */
function capped(ids: Set<string>, what: string, limitations: string[]): Set<string> {
  if (ids.size <= MAX_FILTER_MATCHES) return ids;
  limitations.push(`${what} matched more than ${MAX_FILTER_MATCHES} entities; only the first were used.`);
  return new Set([...ids].slice(0, MAX_FILTER_MATCHES));
}

/** Entities of a type whose field equals the value. */
async function entitiesWithValue(
  scope: RetrievalScope,
  type: string,
  field: string,
  value: string,
  limitations: string[],
  what: string,
): Promise<Set<string>> {
  const definition = scope.loaded.full.entityTypes[type]!;
  const property = definition.properties[field]!;
  const ids = new Set<string>();
  const needle = value.replace(/\s+/g, " ").trim();
  for (let offset = 0; ; offset += PAGE) {
    scope.signal.throwIfAborted();
    const [rows] = await scope.store.listEntities(
      type,
      definition.properties,
      [{ kind: "property", propertyKey: field, dataType: property.dataType, op: "contains", value: needle }],
      null,
      [],
      "_createdAt",
      "asc",
      PAGE,
      offset,
    );
    for (const row of rows) if (sameValue(row[field], value)) ids.add(String(row["_id"]));
    if (rows.length < PAGE || ids.size > MAX_FILTER_MATCHES) break;
  }
  return capped(ids, what, limitations);
}

/** The entities at the start of `path` that reach any of `ids` (entities
 * at its end) through it. */
async function walkBack(
  scope: RetrievalScope,
  path: readonly FilterHop[],
  ids: Set<string>,
  limitations: string[],
  what: string,
): Promise<Set<string>> {
  let frontier = ids;
  for (let h = path.length - 1; h >= 0; h--) {
    const hop = path[h]!;
    const relation = scope.loaded.full.relationTypes[hop.relationTypeKey]!;
    const next = new Set<string>();
    for (const id of frontier) {
      for (let offset = 0; ; offset += PAGE) {
        scope.signal.throwIfAborted();
        // Outgoing hop: the relation runs from the nearer type to `id`.
        const [rows] = await scope.store.listRelations(
          relation.key,
          relation.properties,
          [],
          hop.direction === "outgoing" ? null : id,
          hop.direction === "outgoing" ? id : null,
          "_createdAt",
          "asc",
          PAGE,
          offset,
        );
        for (const row of rows) {
          next.add(String(hop.direction === "outgoing" ? row["fromEntityId"] : row["toEntityId"]));
        }
        if (rows.length < PAGE) break;
      }
      if (next.size > MAX_FILTER_MATCHES) break;
    }
    frontier = capped(next, what, limitations);
  }
  return frontier;
}

function intersect(into: Map<string, Set<string>>, type: string, ids: Set<string>): void {
  const prior = into.get(type);
  into.set(type, prior === undefined ? ids : new Set([...prior].filter((id) => ids.has(id))));
}

/** A sub-query's restrictions, per result type: the ids its filters and
 * previous reference allow. A type without an entry is unrestricted. */
async function restrictionsOf(
  scope: RetrievalScope,
  sub: SubQuery,
  roots: string[],
  previous: Previous | undefined,
  limitations: string[],
): Promise<Map<string, Set<string>>> {
  const restrictions = new Map<string, Set<string>>();
  for (const applied of sub.filters) {
    const filter = scope.config.filters.find((candidate) => candidate.id === applied.id)!;
    const what = `The condition "${filterCondition(scope.lens.scoped, filter, applied.value)}"`;
    const types = pathTypes(scope.loaded, filter.entityType, filter.path);
    const matches = await entitiesWithValue(scope, types.at(-1)!, filter.field, applied.value, limitations, what);
    intersect(restrictions, filter.entityType, await walkBack(scope, filter.path, matches, limitations, what));
  }
  if (sub.previous !== null && previous !== undefined) {
    const filter: RetrieverAgentFilter | null =
      sub.previous.filterId === null
        ? null
        : scope.config.filters.find((candidate) => candidate.id === sub.previous!.filterId)!;
    const types = filter === null ? roots : [pathTypes(scope.loaded, filter.entityType, filter.path).at(-1)!];
    const referenced = previous.results.find((result) => types.includes(result.entityType) && result.ids.length > 0);
    const ids = new Set(referenced?.ids ?? []);
    if (filter === null) {
      if (referenced !== undefined) intersect(restrictions, referenced.entityType, ids);
    } else {
      intersect(
        restrictions,
        filter.entityType,
        await walkBack(scope, filter.path, ids, limitations, "The previous-result reference"),
      );
    }
  }
  return restrictions;
}

// ---------------------------------------------------------------------------
// Sub-queries and fusion
// ---------------------------------------------------------------------------

/** Reciprocal-rank fusion of entity rankings (k = 60); one ranking keeps
 * its order. Each entity keeps its first appearance's payload. */
export function fuseRankings<T extends { entityId: string }>(rankings: readonly (readonly T[])[]): T[] {
  if (rankings.length === 1) return [...rankings[0]!];
  const fused = new Map<string, { item: T; score: number; first: number }>();
  let order = 0;
  rankings.forEach((ranking) =>
    ranking.forEach((item, i) => {
      const contribution = 1 / (RRF_K + i + 1);
      const prior = fused.get(item.entityId);
      if (prior === undefined) fused.set(item.entityId, { item, score: contribution, first: order++ });
      else prior.score += contribution;
    }),
  );
  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.first - b.first)
    .map((entry) => entry.item);
}

/** The relation types whose entries of an index count for a sub-query:
 * the planner's choice within the agent's, else the agent's (null: all). */
function relationsFor(config: RetrieverAgentConfig, index: string, sub: SubQuery): string[] | null {
  const allowed = config.indices.find((reference) => reference.index === index)?.relations ?? null;
  if (sub.relations.length === 0) return allowed;
  return allowed === null ? sub.relations : sub.relations.filter((relation) => allowed.includes(relation));
}

/**
 * One sub-query's ranking. Without restrictions: the search, cut by the
 * agent's similarity threshold. With restrictions (filters, previous
 * results) the candidates are exact: the search only orders them — no
 * threshold — and the restricted entities it did not rank follow, so none
 * is lost to a query that does not describe it. Without a query the
 * restricted entities are listed.
 */
async function runSubQuery(
  scope: RetrievalScope,
  sub: SubQuery,
  previous: Previous | undefined,
  retrieval: Retrieval,
): Promise<Ranked[]> {
  const records = sub.indices.map((key) => scope.records.find((record) => record.key === key)!);
  const roots = [...new Set(records.map((record) => record.definition.entityType))];
  const restrictions = await restrictionsOf(scope, sub, roots, previous, retrieval.limitations);
  const rankings: Ranked[][] = [];
  for (const text of sub.query === "" ? [] : [sub.query, ...sub.variants]) {
    scope.signal.throwIfAborted();
    const started = performance.now();
    const hits = await rankThroughIndices(scope.loaded, scope.indexStore, {
      targets: records.map((index) => ({
        index,
        conditions: [],
        relations: relationsFor(scope.config, index.key, sub),
        entityIds: (() => {
          const ids = restrictions.get(index.definition.entityType);
          return ids === undefined ? null : [...ids];
        })(),
      })),
      query: text,
      mode: sub.mode,
      matching: "any",
      relations: null,
      minScore:
        sub.mode === "keyword" || restrictions.size > 0 ? null : similarityFloor(scope.config.threshold),
      limit: SUB_QUERY_LIMIT,
    });
    retrieval.searchCalls += 1;
    retrieval.searchMs += performance.now() - started;
    rankings.push(hits.map((hit) => ({ entityId: hit.entityId, entityType: hit.entityType, hit })));
  }
  const ranked = rankings.length === 0 ? [] : fuseRankings(rankings);
  const found = new Set(ranked.map((item) => item.entityId));
  const rest: Ranked[] = [];
  for (const [entityType, ids] of restrictions) {
    for (const entityId of [...ids].sort()) {
      if (!found.has(entityId)) rest.push({ entityId, entityType, hit: null });
    }
  }
  const room = Math.max(0, LIST_LIMIT - ranked.length);
  if (rest.length > room) {
    retrieval.limitations.push(
      `${ranked.length + rest.length} entities match the exact constraints; only ` +
        `${ranked.length + room} were listed. The list is incomplete.`,
    );
  }
  return [...ranked, ...rest.slice(0, room)];
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

function cut(value: unknown, characters: number): { value: unknown; cut: boolean } {
  if (typeof value === "string" && value.length > characters) {
    return { value: `${value.slice(0, characters)} [truncated]`, cut: true };
  }
  return { value: value ?? null, cut: false };
}

/** The entities of the fused ranking, projected through the lens, by id. */
async function readEntities(scope: RetrievalScope, ranked: readonly Ranked[]): Promise<Map<string, Row>> {
  const byType = new Map<string, string[]>();
  for (const item of ranked) byType.set(item.entityType, [...(byType.get(item.entityType) ?? []), item.entityId]);
  const entities = new Map<string, Row>();
  for (const [type, ids] of byType) {
    const scoped = scope.loaded.scoped.entityTypes[type];
    const full = scope.loaded.full.entityTypes[type];
    if (scoped === undefined || full === undefined) continue;
    const rows = await scope.store.getEntitiesByIds(ids, full.properties);
    for (const [id, row] of Object.entries(rows)) {
      entities.set(id, filterEntityProperties(row, scoped, scope.config.answerFields[type] ?? null));
    }
  }
  return entities;
}

/** Run every sub-query of the plan and fuse their results. */
export async function retrieve(scope: RetrievalScope, plan: Plan, previous?: Previous): Promise<Retrieval> {
  const retrieval: Retrieval = {
    items: [],
    limitations: plan.unsupportedReason ? [plan.unsupportedReason] : [],
    searchCalls: 0,
    searchMs: 0,
  };
  const perSubQuery: Ranked[][] = [];
  for (const sub of plan.subQueries) perSubQuery.push(await runSubQuery(scope, sub, previous, retrieval));

  const building = [...new Set(plan.subQueries.flatMap((sub) => sub.indices))].flatMap((key) => {
    const entry = scope.lens.catalog.find((candidate) => candidate.key === key);
    return entry === undefined || entry.status === "ready" ? [] : [entry.name];
  });
  if (building.length > 0) {
    retrieval.limitations.push(
      `Search indices not fully built (${building.join(", ")}); results may be incomplete.`,
    );
  }

  // Per sub-query, what matched each entity.
  const matchesOf = new Map<string, SubQueryMatch[]>();
  const hidesText = new Map<string, boolean>();
  // The filters each sub-query applied, per result type: facts its
  // results satisfy, which the answer may state.
  const factsOf = (subQuery: number, entityType: string): string[] =>
    plan.subQueries[subQuery]!.filters.flatMap((applied) => {
      const filter = scope.config.filters.find((candidate) => candidate.id === applied.id);
      if (filter === undefined || filter.entityType !== entityType) return [];
      return [filterCondition(scope.lens.scoped, filter, applied.value)];
    });
  for (const [subQuery, ranked] of perSubQuery.entries()) {
    const hits = ranked.flatMap((item) => (item.hit === null ? [] : [item.hit]));
    const described = await describeMatches(scope.loaded, scope.store, hits);
    for (const item of ranked) {
      let text: string | null = null;
      if (item.hit !== null) {
        const { index, entry } = item.hit.matched;
        if (!hidesText.has(index.key)) {
          hidesText.set(index.key, readsHiddenProperties(index.definition, scope.loaded.full, scope.loaded.scoped));
        }
        text = hidesText.get(index.key) ? null : (cut(entry.text, scope.config.answerFieldCharacters).value as string);
      }
      const match: SubQueryMatch = {
        subQuery,
        matched: item.hit === null ? null : described.get(item.entityId) ?? null,
        text,
        filters: factsOf(subQuery, item.entityType),
      };
      matchesOf.set(item.entityId, [...(matchesOf.get(item.entityId) ?? []), match]);
    }
  }

  const fused = fuseRankings(perSubQuery);
  const entities = await readEntities(scope, fused);
  const truncated = new Set<string>();
  for (const item of fused) {
    const entity = entities.get(item.entityId);
    if (entity === undefined) continue;
    const fields: Row = {};
    for (const field of scope.config.answerFields[item.entityType] ?? []) {
      const { value, cut: wasCut } = cut(entity[field], scope.config.answerFieldCharacters);
      fields[field] = value;
      if (wasCut) truncated.add(scope.lens.scoped.entityTypes[item.entityType]?.properties[field]?.displayName ?? field);
    }
    const nameProperty = scope.loaded.scoped.entityTypes[item.entityType]?.nameProperty ?? null;
    const name = nameProperty === null ? null : entity[nameProperty];
    retrieval.items.push({
      entityId: item.entityId,
      entityType: item.entityType,
      label: typeof name === "string" && name !== "" ? name : null,
      fields,
      matches: matchesOf.get(item.entityId) ?? [],
    });
  }
  if (truncated.size > 0) {
    retrieval.limitations.push(
      `Answer fields cut to ${scope.config.answerFieldCharacters} characters: ${[...truncated].sort().join(", ")}.`,
    );
  }
  return retrieval;
}

// ---------------------------------------------------------------------------
// The answer model's context and the diagnostics
// ---------------------------------------------------------------------------

/** One result as the answer model gets it: in the lens's display names —
 * no ids, keys or paths, which it would otherwise repeat. */
export interface Evidence {
  /** The entity type's display name. */
  type: string;
  label: string | null;
  /** Answer fields by display name. */
  fields: Row;
  /** Per sub-query that found the entity: its query ("" for an exact
   * list), what matched and the matched text. */
  matches: {
    search: string;
    /** "own fields", a relation group's label, or "passage of <document>". */
    entry?: string;
    /** The entity on the other end of a relation entry. */
    related?: string | null;
    relatedType?: string | null;
    text?: string | null;
    /** Exact filters the entity satisfies — established facts. */
    filters?: string[];
  }[];
}

export interface ResponseContext {
  results: Evidence[];
  /** Results that did not fit. */
  omitted: number;
  limitations: string[];
}

/** What a matched index entry is, in plain words. */
function entryName(lens: AgentLens, matched: Matched): string {
  if (matched.partKind === "self") return "own fields";
  if (matched.partKind === "relation") return relationName(lens, [matched.index], matched.relationType ?? "");
  const entry = lens.catalog.find((candidate) => candidate.key === matched.index);
  const document = entry?.documentProperty ?? null;
  const name = document === null ? undefined : lens.scoped.entityTypes[entry!.entityType]?.properties[document]?.displayName;
  return name === undefined ? "document passage" : `passage of ${name}`;
}

/** Answer fields keyed by their display names (a clash keeps the key). */
function namedFields(lens: AgentLens, entityType: string, fields: Row): Row {
  const properties = lens.scoped.entityTypes[entityType]?.properties ?? {};
  const named: Row = {};
  for (const [key, value] of Object.entries(fields)) {
    const name = properties[key]?.displayName ?? key;
    named[name in named ? key : name] = value;
  }
  return named;
}

/** The evidence that fits `CONTEXT_CHARACTERS`, best first, in display
 * names; ids, keys, scores and diagnostics stay out. */
export function boundContext(retrieval: Retrieval, plan: Plan, lens: AgentLens): ResponseContext {
  const context: ResponseContext = { results: [], omitted: 0, limitations: [...retrieval.limitations] };
  for (const item of retrieval.items) {
    context.results.push({
      type: lens.scoped.entityTypes[item.entityType]?.displayName ?? item.entityType,
      label: item.label,
      fields: namedFields(lens, item.entityType, item.fields),
      matches: item.matches.map((match) => ({
        search: plan.subQueries[match.subQuery]?.query ?? "",
        ...(match.matched === null
          ? {}
          : {
              entry: entryName(lens, match.matched),
              ...(match.matched.target === null
                ? {}
                : {
                    related: match.matched.target.label,
                    relatedType: lens.scoped.entityTypes[match.matched.target.type]?.displayName ?? null,
                  }),
              text: match.text,
            }),
        ...(match.filters.length === 0 ? {} : { filters: match.filters }),
      })),
    });
    if (JSON.stringify(context).length > CONTEXT_CHARACTERS - 400) {
      context.results.pop();
      context.omitted += 1;
    }
  }
  if (context.omitted > 0) {
    context.limitations.push(
      `${context.omitted} technically selected candidates were omitted from the response context. ` +
        "Their relevance was not assessed by the response model; they are not established " +
        "additional matches. The response may be incomplete.",
    );
  }
  return context;
}

/** The plan's searches as the answer model gets them: each query ("" for
 * an exact list), the relation groups it was restricted to and its exact
 * conditions, in display names. */
export function answerSearches(plan: Plan, config: RetrieverAgentConfig, lens: AgentLens) {
  return plan.subQueries.map((sub) => ({
    query: sub.query,
    relations: sub.relations.map((relation) => relationName(lens, sub.indices, relation)),
    filters: sub.filters.flatMap((applied) => {
      const filter = config.filters.find((candidate) => candidate.id === applied.id);
      return filter === undefined ? [] : [filterCondition(lens.scoped, filter, applied.value)];
    }),
  }));
}

/** One diagnostics row per entity and sub-query that found it, in fused order. */
export function diagnosticResults(retrieval: Retrieval) {
  return retrieval.items.flatMap((item) =>
    item.matches.map((match) => ({
      entityId: item.entityId,
      entityType: item.entityType,
      label: item.label,
      subQuery: match.subQuery,
      ...(match.matched === null ? {} : { matched: match.matched }),
      answerFields: item.fields,
    })),
  );
}

/** The result ids per entity type, for a follow-up's reference. */
export function resultIds(retrieval: Retrieval): { entityType: string; ids: string[] }[] {
  const byType = new Map<string, string[]>();
  for (const item of retrieval.items) byType.set(item.entityType, [...(byType.get(item.entityType) ?? []), item.entityId]);
  return [...byType].map(([entityType, ids]) => ({ entityType, ids }));
}
