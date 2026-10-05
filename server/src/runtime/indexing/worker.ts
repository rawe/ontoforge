/**
 * The search worker: builds search entries from the queue.
 *
 * It runs in every server process whose adapter stores search indices
 * (`startSearchWorker`, from `main.ts`); several processes share the
 * queue safely. One pass (`drainOnce`) visits every ontology:
 *
 * 1. Claim a batch under a lease — keyword items first, they need no
 *    provider call — and commit the claim.
 * 2. Compose each claimed part from the entity's current state (its
 *    relations of the grouped types, their targets, its document), read
 *    outside any transaction — never a transaction across an HTTP call.
 * 3. Skip parts whose text hash is unchanged; embed the rest in provider
 *    batches (semantic); write the entries and drop the parts that no
 *    longer exist.
 * 4. Complete the claim. On failure: attempts + 1 and exponential backoff;
 *    after `SEARCH_MAX_ATTEMPTS` the item counts as failed and stays
 *    queued for status until a rebuild or a new write of its entity.
 * 5. Finish every building generation whose queue is empty: it becomes
 *    the one queries read.
 *
 * Between passes it sleeps until an enqueue notifies it or the polling
 * interval (`SEARCH_POLL_MS`) passes. At start it syncs every ontology's
 * managed indices, sweeps leftover partitions and reconciles the
 * generations (`managed.ts`, `generations.ts`). Tests drive passes directly (`drainSearchWork`).
 *
 * The worker measures entries written per second per representation —
 * a moving average, kept in memory — for the cost preview
 * (`searchEntryRates`).
 */

import { settings } from "../../config.js";
import { getEmbeddingProvider, type EmbeddingProvider } from "../../core/embedding.js";
import {
  getOntologyRegistry,
  getRuntimeStore,
  getSearchIndexStore,
  subscribeSearchWork,
  supportsSearchIndices,
  type ClaimedSearchQueueItem,
  type RuntimeStore,
  type SearchEntryWrite,
  type SearchGenerationRecord,
  type SearchIndexStore,
  type SearchPartKind,
  type SearchWorkSubscription,
} from "../../core/ports.js";
import type { PropertyDef } from "../../core/schemas.js";
import {
  composePassages,
  composeRelation,
  composeSelf,
  documentField,
  groupTargetType,
  type ComposedPart,
  type ComposeEntity,
} from "../../core/searchComposition.js";
import { entryTextHash } from "../../core/searchEntry.js";
import type { SearchIndexDefinition, SearchRepresentation } from "../../core/searchIndex.js";
import {
  backoffDelayMs,
  DEFAULT_ENTRY_RATES,
  ThroughputAverage,
} from "../../core/searchPipeline.js";
import { loadSearchContextUncached, type SearchContext } from "../schemaCache.js";
import { chunkDocument } from "../search/chunking.js";
import { syncManagedSearchIndices } from "./managed.js";

type Row = Record<string, unknown>;

/** How long a claim may take before another worker may take it over. */
const LEASE_SECONDS = 300;

/** Every relation of an entity in one group is composed — no cap. */
const ALL_RELATIONS = 2 ** 31 - 1;

/** The knobs of a pass; the settings unless a test overrides them. */
export interface SearchWorkOptions {
  /** Restrict the pass to one ontology. */
  ontologyKey?: string;
  batchSize?: number;
  maxAttempts?: number;
  /** The delay after an item's `attempts`-th failure. */
  backoffMs?: (attempts: number) => number;
}

interface ResolvedOptions {
  batchSize: number;
  maxAttempts: number;
  backoffMs: (attempts: number) => number;
}

function resolve(options: SearchWorkOptions): ResolvedOptions {
  return {
    batchSize: options.batchSize ?? settings.SEARCH_WORKER_BATCH,
    maxAttempts: options.maxAttempts ?? settings.SEARCH_MAX_ATTEMPTS,
    backoffMs: options.backoffMs ?? ((attempts) => backoffDelayMs(attempts)),
  };
}

// ---------------------------------------------------------------------------
// Throughput
// ---------------------------------------------------------------------------

const throughput: Record<SearchRepresentation, ThroughputAverage> = {
  keyword: new ThroughputAverage(),
  semantic: new ThroughputAverage(),
};

export interface EntryRate {
  entriesPerSecond: number;
  /** False while nothing was measured yet and the rate is the default. */
  measured: boolean;
}

/** Entries per second per representation: the worker's moving average in
 * this process, or the default rate before it measured any. */
export function searchEntryRates(): Record<SearchRepresentation, EntryRate> {
  const rate = (representation: SearchRepresentation): EntryRate => {
    const value = throughput[representation].value;
    return value === null
      ? { entriesPerSecond: DEFAULT_ENTRY_RATES[representation], measured: false }
      : { entriesPerSecond: value, measured: true };
  };
  return { keyword: rate("keyword"), semantic: rate("semantic") };
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

/**
 * One pass: per ontology one claimed batch processed, then its finished
 * builds switched in. The count of queue items processed (completed or
 * failed). Nothing when the adapter stores no search indices.
 */
export async function drainOnce(options: SearchWorkOptions = {}): Promise<number> {
  if (!(await supportsSearchIndices())) return 0;
  const resolved = resolve(options);
  const keys =
    options.ontologyKey !== undefined
      ? [options.ontologyKey]
      : (await getOntologyRegistry().listOntologies()).map((row) => row["key"] as string);
  let processed = 0;
  for (const ontologyKey of keys) {
    try {
      processed += await processOntology(ontologyKey, resolved);
    } catch (exc) {
      // An ontology deleted mid-pass, a storage failure: the next pass
      // tries again; the others go on.
      console.warn(`Search work in ontology '${ontologyKey}' failed: ${message(exc)}`);
    }
  }
  return processed;
}

/** Passes until one finds nothing to do — everything due is processed
 * and every finished build switched in. Items held back by a backoff wait
 * for a later pass. The count of items processed. */
export async function drainSearchWork(options: SearchWorkOptions = {}): Promise<number> {
  let total = 0;
  for (;;) {
    const processed = await drainOnce(options);
    total += processed;
    if (processed === 0) return total;
  }
}

async function processOntology(ontologyKey: string, options: ResolvedOptions): Promise<number> {
  const store = await getSearchIndexStore(ontologyKey);
  const provider = getEmbeddingProvider();
  const claimed = await store.claimQueueItems({
    limit: options.batchSize,
    leaseSeconds: LEASE_SECONDS,
    maxAttempts: options.maxAttempts,
    semanticModelId: provider?.modelId ?? null,
  });
  if (claimed.length > 0) {
    const runtime = await getRuntimeStore(ontologyKey);
    // Read fresh, not from the cache: another process may have changed
    // the definitions.
    const context = await loadSearchContextUncached(store);
    const generations = new Map(
      (await store.listGenerations()).map((g) => [g.generationId, g] as const),
    );
    const byGeneration = groupBy(claimed, (item) => item.generationId);
    for (const [generationId, items] of byGeneration) {
      const generation = generations.get(generationId);
      const started = Date.now();
      try {
        const written =
          generation === undefined
            ? 0
            : await processGeneration(store, runtime, context, generation, items, provider);
        await store.completeQueueItems(items);
        if (generation?.state === "building") {
          await store.recordGenerationProgress(generationId, { done: items.length });
        }
        if (generation !== undefined) {
          throughput[generation.representation].record(written, Date.now() - started);
        }
      } catch (exc) {
        await failItems(store, items, exc, options);
      }
    }
  }
  await finishBuilds(store, options.maxAttempts);
  return claimed.length;
}

async function failItems(
  store: SearchIndexStore,
  items: ClaimedSearchQueueItem[],
  exc: unknown,
  options: ResolvedOptions,
): Promise<void> {
  const error = message(exc);
  console.warn(`Search entries of generation ${items[0]!.generationId} failed: ${error}`);
  await store.failQueueItems(
    items.map((item) => ({ item, delayMs: options.backoffMs(item.attempts + 1) })),
    error,
  );
  const exhausted = items.filter((item) => item.attempts + 1 >= options.maxAttempts).length;
  if (exhausted > 0) {
    await store.recordGenerationProgress(items[0]!.generationId, { failed: exhausted });
  }
}

/** Switch in every building generation with nothing left in its queue. A
 * build with items failed for good stays building — status reports it
 * failed, and the active generation keeps serving. */
async function finishBuilds(store: SearchIndexStore, maxAttempts: number): Promise<void> {
  const [generations, stats] = await Promise.all([
    store.listGenerations(),
    store.queueStats(maxAttempts),
  ]);
  const queued = new Set(stats.map((s) => s.generationId));
  for (const generation of generations) {
    if (generation.state === "building" && !queued.has(generation.generationId)) {
      await store.finishGeneration(generation.generationId);
    }
  }
}

// ---------------------------------------------------------------------------
// Composition of one generation's items
// ---------------------------------------------------------------------------

/** Compose, hash-skip, embed and write the claimed items of one
 * generation. The count of entries written. Throws on any failure — the
 * caller fails the whole batch. */
async function processGeneration(
  store: SearchIndexStore,
  runtime: RuntimeStore,
  context: SearchContext,
  generation: SearchGenerationRecord,
  items: ClaimedSearchQueueItem[],
  provider: EmbeddingProvider | null,
): Promise<number> {
  const index = context.indices.find((i) => i.searchIndexId === generation.searchIndexId);
  if (index === undefined) return 0;
  const definition = index.definition;
  const representation = generation.representation;

  const parts = new Map<string, { entityId: string; part: ComposedPart }>();
  const deletions: (() => Promise<unknown>)[] = [];
  for (const [entityId, entityItems] of groupBy(items, (item) => item.entityId)) {
    const composed = await composeItems(runtime, context, definition, entityId, entityItems);
    for (const part of composed.parts) {
      parts.set(`${entityId}/${part.partKind}/${part.groupNo}/${part.partId}`, { entityId, part });
    }
    for (const { partKind, groupNo, keep } of composed.replace) {
      deletions.push(() =>
        store.deleteEntityPartsExcept(generation.generationId, entityId, partKind, groupNo, keep),
      );
    }
    if (composed.gone.length > 0) {
      deletions.push(() =>
        store.deleteEntries(
          generation.generationId,
          composed.gone.map((part) => ({ entityId, ...part })),
        ),
      );
    }
  }

  const hashKey =
    representation === "semantic" ? generation.modelId : (generation.languages ?? []).join(",");
  const candidates = [...parts.values()].map(({ entityId, part }) => {
    const text = representation === "semantic" ? part.semanticText : part.keywordText;
    return { entityId, part, text, textHash: entryTextHash(text, representation, hashKey) };
  });
  const stored = new Map(
    (
      await store.readEntryHashes(
        generation.generationId,
        candidates.map(({ entityId, part }) => ({
          entityId,
          partKind: part.partKind,
          groupNo: part.groupNo,
          partId: part.partId,
        })),
      )
    ).map((h) => [`${h.entityId}/${h.partKind}/${h.groupNo}/${h.partId}`, h.textHash] as const),
  );
  const changed = candidates.filter(
    ({ entityId, part, textHash }) =>
      stored.get(`${entityId}/${part.partKind}/${part.groupNo}/${part.partId}`) !== textHash,
  );

  let vectors: number[][] = [];
  if (representation === "semantic" && changed.length > 0) {
    if (provider === null || provider.modelId !== generation.modelId) {
      throw new Error(`No embedding provider for model ${generation.modelId}`);
    }
    vectors = await provider.embedBatch(changed.map((c) => c.text));
  }

  const writes: SearchEntryWrite[] = changed.map(({ entityId, part, text, textHash }, i) => ({
    entityId,
    partKind: part.partKind,
    groupNo: part.groupNo,
    partId: part.partId,
    relationType: part.relationType,
    targetType: part.targetType,
    targetId: part.targetId,
    startChar: part.startChar,
    charLength: part.charLength,
    text,
    textHash,
    embedding: representation === "semantic" ? vectors[i]! : null,
  }));
  if (!(await store.upsertEntries(generation.generationId, writes))) {
    // The generation retired meanwhile: nothing left to do for it.
    return 0;
  }
  for (const deletion of deletions) {
    await deletion();
  }
  return writes.length;
}

interface ComposedItems {
  parts: ComposedPart[];
  /** Part kinds and groups composed whole: entries not among `keep` go. */
  replace: { partKind: SearchPartKind; groupNo: number; keep: string[] }[];
  /** Single parts that no longer exist. */
  gone: { partKind: SearchPartKind; groupNo: number; partId: string }[];
}

/** Compose what an entity's claimed items ask for, from its current state. */
async function composeItems(
  runtime: RuntimeStore,
  context: SearchContext,
  definition: SearchIndexDefinition,
  entityId: string,
  items: ClaimedSearchQueueItem[],
): Promise<ComposedItems> {
  const { schema } = context;
  const result: ComposedItems = { parts: [], replace: [], gone: [] };
  const root = schema.entityTypes[definition.entityType];
  const row = root === undefined ? null : await runtime.getEntityById(entityId, root.properties);

  // Gone, or no longer of the root type: every part of it goes.
  if (row === null || row["_entityTypeKey"] !== definition.entityType) {
    result.replace.push({ partKind: "self", groupNo: 0, keep: [] });
    result.replace.push({ partKind: "passage", groupNo: 0, keep: [] });
    definition.relations.forEach((_group, groupNo) =>
      result.replace.push({ partKind: "relation", groupNo, keep: [] }),
    );
    return result;
  }
  const entity: ComposeEntity = { id: entityId, properties: row };
  const whole = items.some((item) => item.partKind === "entity");
  const asked = (kind: SearchPartKind) => whole || items.some((item) => item.partKind === kind);

  if (asked("self")) {
    const self = composeSelf(definition, schema, entity);
    if (self !== null) result.parts.push(self);
    result.replace.push({ partKind: "self", groupNo: 0, keep: self === null ? [] : [""] });
  }

  if (asked("passage")) {
    const field = documentField(definition, schema);
    const value = field === null ? null : row[field];
    const chunks =
      typeof value === "string"
        ? chunkDocument(value, settings.DOCUMENT_CHUNK_SIZE, settings.DOCUMENT_CHUNK_OVERLAP)
        : [];
    const passages = composePassages(definition, schema, entity, chunks);
    result.parts.push(...passages);
    result.replace.push({ partKind: "passage", groupNo: 0, keep: passages.map((p) => p.partId) });
  }

  const definitionsByType: Record<string, Record<string, PropertyDef>> = {};
  for (const type of [...Object.values(schema.entityTypes), ...Object.values(schema.relationTypes)]) {
    definitionsByType[type.key] = type.properties;
  }

  if (whole) {
    for (const [groupNo, group] of definition.relations.entries()) {
      const neighbours =
        group.relationType in schema.relationTypes
          ? await runtime.getNeighbors(
              entityId,
              group.direction,
              group.relationType,
              ALL_RELATIONS,
              definitionsByType,
            )
          : [];
      const composed: ComposedPart[] = [];
      for (const neighbour of neighbours) {
        const relation = neighbour["relation"] as Row;
        const target = neighbour["entity"] as Row;
        const part = composeRelation(definition, schema, entity, groupNo, {
          id: relation["_id"] as string,
          properties: relation,
          target: {
            id: target["_id"] as string,
            typeKey: target["_entityTypeKey"] as string,
            properties: target,
          },
        });
        if (part !== null) composed.push(part);
      }
      result.parts.push(...composed);
      result.replace.push({ partKind: "relation", groupNo, keep: composed.map((p) => p.partId) });
    }
    return result;
  }

  for (const item of items.filter((i) => i.partKind === "relation")) {
    const part = await composeOneRelation(runtime, context, definition, entity, item, definitionsByType);
    if (part !== null) {
      result.parts.push(part);
    } else {
      result.gone.push({ partKind: "relation", groupNo: item.groupNo, partId: item.partId });
    }
  }
  return result;
}

/** One relation's part, or null when the relation is gone or no longer
 * belongs to the entity in that group. */
async function composeOneRelation(
  runtime: RuntimeStore,
  context: SearchContext,
  definition: SearchIndexDefinition,
  entity: ComposeEntity,
  item: ClaimedSearchQueueItem,
  definitionsByType: Record<string, Record<string, PropertyDef>>,
): Promise<ComposedPart | null> {
  const group = definition.relations[item.groupNo];
  const targetType = groupTargetType(definition, item.groupNo, context.schema);
  if (group === undefined || targetType === null) return null;
  const relation = await runtime.getRelation(group.relationType, item.partId);
  if (relation === null) return null;
  const outgoing = group.direction === "outgoing";
  const owner = outgoing ? relation["fromEntityId"] : relation["toEntityId"];
  const otherId = (outgoing ? relation["toEntityId"] : relation["fromEntityId"]) as string;
  if (owner !== entity.id) return null;
  const target = await runtime.getEntityById(otherId, definitionsByType[targetType] ?? {});
  if (target === null) return null;
  return composeRelation(definition, context.schema, entity, item.groupNo, {
    id: item.partId,
    properties: relation,
    target: { id: otherId, typeKey: targetType, properties: target },
  });
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

class SearchWorker {
  private running = false;
  private loop: Promise<void> | null = null;
  /** Ends the current sleep, if the worker sleeps. */
  private wake: (() => void) | null = null;
  /** A wake-up arrived during the current pass. */
  private woken = false;
  private subscription: SearchWorkSubscription | null = null;

  start(): void {
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.woken = true;
    this.wake?.();
    await this.loop;
    await this.subscription?.close();
    this.subscription = null;
  }

  private async run(): Promise<void> {
    await this.prepare();
    while (this.running) {
      await this.subscribe();
      this.woken = false;
      let processed = 0;
      try {
        processed = await drainOnce();
      } catch (exc) {
        console.warn(`Search worker pass failed: ${message(exc)}`);
      }
      if (processed === 0 && this.running && !this.woken) {
        await this.sleep(settings.SEARCH_POLL_MS);
      }
    }
  }

  /** Bring every ontology's managed indices in step with its schema, sweep
   * leftover partitions and reconcile the generations — a changed model or
   * language set starts its new generations here, and so does the backfill
   * after a storage upgrade. */
  private async prepare(): Promise<void> {
    let keys: string[] = [];
    try {
      keys = (await getOntologyRegistry().listOntologies()).map((row) => row["key"] as string);
    } catch (exc) {
      console.warn(`Search worker could not list ontologies: ${message(exc)}`);
    }
    for (const ontologyKey of keys) {
      if (!this.running) return;
      try {
        // Sweeps and reconciles as well.
        await syncManagedSearchIndices(await getSearchIndexStore(ontologyKey));
      } catch (exc) {
        console.warn(`Search generations of ontology '${ontologyKey}' not reconciled: ${message(exc)}`);
      }
    }
  }

  /** (Re)subscribe to wake-ups; polling covers the time without. */
  private async subscribe(): Promise<void> {
    if (this.subscription !== null && !this.subscription.closed) return;
    try {
      this.subscription = await subscribeSearchWork(() => {
        this.woken = true;
        this.wake?.();
      });
    } catch (exc) {
      this.subscription = null;
      console.warn(`Search worker runs without wake-ups: ${message(exc)}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }
}

let worker: SearchWorker | null = null;

/** Start this process's worker, when the adapter stores search indices.
 * Startup only; a second call is a no-op. */
export async function startSearchWorker(): Promise<void> {
  if (worker !== null || !(await supportsSearchIndices())) return;
  worker = new SearchWorker();
  worker.start();
}

/** Stop the worker after the pass it is in. Shutdown only. */
export async function stopSearchWorker(): Promise<void> {
  const running = worker;
  worker = null;
  await running?.stop();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group === undefined) groups.set(k, [item]);
    else group.push(item);
  }
  return groups;
}

function message(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc);
}
