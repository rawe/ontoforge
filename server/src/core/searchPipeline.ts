/**
 * The arithmetic of the search pipeline: retry backoff, the status of an
 * index, and the throughput the worker measures.
 *
 * Pure — no storage, no I/O, no clock of its own.
 */

import type {
  SearchGenerationRecord,
  SearchQueueError,
  SearchQueueStats,
  SearchSettings,
} from "./ports.js";
import type { SearchRepresentation } from "./searchIndex.js";

// ---------------------------------------------------------------------------
// Switched-off managed indices
// ---------------------------------------------------------------------------

/** The managed indices switched off, by key. Stored in the settings as
 * `{ "<key>": true }`; any other value counts as on. */
export function disabledIndexKeys(settings: Pick<SearchSettings, "disabledDefaults">): Set<string> {
  return new Set(
    Object.entries(settings.disabledDefaults)
      .filter(([, off]) => off === true)
      .map(([key]) => key),
  );
}

/** The stored form of a set of switched-off managed indices. */
export function disabledDefaultsOf(keys: Iterable<string>): Record<string, true> {
  return Object.fromEntries([...new Set(keys)].sort().map((key) => [key, true] as const));
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

/** The first retry's delay. */
export const BACKOFF_BASE_MS = 5_000;

/** The longest a retry is held back. */
export const BACKOFF_CAP_MS = 10 * 60_000;

/** How long an item waits after its `attempts`-th failure: doubling from
 * the base, capped. */
export function backoffDelayMs(
  attempts: number,
  baseMs: number = BACKOFF_BASE_MS,
  capMs: number = BACKOFF_CAP_MS,
): number {
  if (attempts < 1 || baseMs <= 0) return 0;
  return Math.min(capMs, baseMs * 2 ** Math.min(attempts - 1, 30));
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * The state of one representation of an index, or of the index as a whole:
 *
 * - `ready` — the active generation is current.
 * - `building` — a new generation is filling (`build`).
 * - `stale` — the active generation has queued work (`pending`).
 * - `failed` — items failed for good (`failed`); a rebuild retries them.
 * - `unavailable` — semantic without an embedding provider.
 * - `disabled` — the definition switches the representation off, or (for
 *   the index as a whole) a managed index is switched off.
 */
export type SearchIndexState =
  | "ready"
  | "building"
  | "stale"
  | "failed"
  | "unavailable"
  | "disabled";

export interface SearchRepresentationStatus {
  representation: SearchRepresentation;
  state: SearchIndexState;
  /** The filling generation's progress — entities composed of the
   * backfill, and its size; `null` while no generation is filling. */
  build: { done: number; total: number } | null;
  /** Queued items not yet processed (building and active generation). */
  pending: number;
  /** Items failed for good. */
  failed: number;
  /** The generation queries read, if any. */
  activeGenerationId: string | null;
  /** The generation filling, if any. */
  buildingGenerationId: string | null;
  lastErrors: SearchQueueError[];
}

export interface SearchIndexStatus {
  state: SearchIndexState;
  representations: SearchRepresentationStatus[];
  lastErrors: SearchQueueError[];
}

/** The most errors a status lists. */
export const MAX_LAST_ERRORS = 10;

/** Errors of several queues as one list: newest first, the newest per
 * distinct message, at most `MAX_LAST_ERRORS`. */
export function mergeLastErrors(lists: readonly (readonly SearchQueueError[])[]): SearchQueueError[] {
  const newest = new Map<string, SearchQueueError>();
  for (const error of lists.flat().sort((a, b) => b.at.getTime() - a.at.getTime())) {
    if (!newest.has(error.message)) newest.set(error.message, error);
  }
  return [...newest.values()].slice(0, MAX_LAST_ERRORS);
}

/** What the status of one representation is derived from. */
export interface RepresentationStatusInput {
  representation: SearchRepresentation;
  enabled: boolean;
  /** Semantic: whether an embedding provider is configured. */
  available: boolean;
  /** Building and ready generations of the index and representation. */
  generations: SearchGenerationRecord[];
  queue: SearchQueueStats[];
}

const NO_QUEUE = { pending: 0, failed: 0, lastErrors: [] as SearchQueueError[] };

/** The status of one representation. */
export function deriveRepresentationStatus(input: RepresentationStatusInput): SearchRepresentationStatus {
  const building = input.generations.find((g) => g.state === "building") ?? null;
  const ready = input.generations.find((g) => g.state === "ready") ?? null;
  const queueOf = (generation: SearchGenerationRecord | null) =>
    (generation && input.queue.find((q) => q.generationId === generation.generationId)) || NO_QUEUE;
  const buildingQueue = queueOf(building);
  const readyQueue = queueOf(ready);
  const status: SearchRepresentationStatus = {
    representation: input.representation,
    state: "ready",
    build: null,
    pending: buildingQueue.pending + readyQueue.pending,
    failed: buildingQueue.failed + readyQueue.failed,
    activeGenerationId: ready?.generationId ?? null,
    buildingGenerationId: building?.generationId ?? null,
    lastErrors: mergeLastErrors([buildingQueue.lastErrors, readyQueue.lastErrors]),
  };
  if (!input.enabled) return { ...status, state: "disabled" };
  if (!input.available) return { ...status, state: "unavailable" };
  if (building !== null) {
    status.build = {
      done: Math.max(0, building.total - buildingQueue.pending - buildingQueue.failed),
      total: building.total,
    };
    // A build whose remaining items all failed for good never finishes.
    status.state = buildingQueue.failed > 0 && buildingQueue.pending === 0 ? "failed" : "building";
    return status;
  }
  if (ready === null || readyQueue.pending > 0) return { ...status, state: "stale" };
  return { ...status, state: readyQueue.failed > 0 ? "failed" : "ready" };
}

const SEVERITY: Record<SearchIndexState, number> = {
  disabled: 0,
  unavailable: 0,
  ready: 1,
  stale: 2,
  building: 3,
  failed: 4,
};

/** The status of a switched-off managed index: no generations, nothing
 * to report per representation. */
export function disabledIndexStatus(): SearchIndexStatus {
  return { state: "disabled", representations: [], lastErrors: [] };
}

/** The status of an index: its representations, and the most severe of
 * their states — `unavailable` only when no representation is usable. */
export function deriveIndexStatus(representations: SearchRepresentationStatus[]): SearchIndexStatus {
  let state: SearchIndexState = "unavailable";
  for (const representation of representations) {
    if (SEVERITY[representation.state] > SEVERITY[state]) state = representation.state;
  }
  return {
    state,
    representations,
    lastErrors: mergeLastErrors(representations.map((r) => r.lastErrors)),
  };
}

// ---------------------------------------------------------------------------
// Throughput
// ---------------------------------------------------------------------------

/** Entries per second assumed before the worker measured any — the cost
 * preview's fallback. Keyword entries cost a statement; semantic entries
 * an embedding call. */
export const DEFAULT_ENTRY_RATES: Readonly<Record<SearchRepresentation, number>> = {
  keyword: 500,
  semantic: 20,
};

/** Weight of the newest sample in the moving average. */
const SMOOTHING = 0.3;

/** An exponential moving average of entries per second. */
export class ThroughputAverage {
  private average: number | null = null;

  /** Add one measurement: `entries` written in `elapsedMs`. Measurements
   * without entries or time say nothing and are ignored. */
  record(entries: number, elapsedMs: number): void {
    if (entries <= 0 || elapsedMs <= 0) return;
    const rate = entries / (elapsedMs / 1000);
    this.average = this.average === null ? rate : SMOOTHING * rate + (1 - SMOOTHING) * this.average;
  }

  /** The average, or null before the first measurement. */
  get value(): number | null {
    return this.average;
  }
}

// ---------------------------------------------------------------------------
// Cost preview
// ---------------------------------------------------------------------------

/** What a full build of an index holds, as the store measures it: the
 * root-type entities and the entries of each part kind. */
export interface IndexContentSize {
  entities: number;
  selfEntries: number;
  relationEntries: number;
  passageEntries: number;
}

/** Entries per second of one representation; `measured` false while it
 * is a default rate. */
export interface RepresentationRate {
  entriesPerSecond: number;
  measured: boolean;
}

export interface CostEstimate {
  entities: number;
  /** Entries per representation: self + relation instances + passages. */
  entries: number;
  /** Every representation built one after the other. */
  seconds: number;
  perRepresentation: {
    representation: SearchRepresentation;
    entries: number;
    seconds: number;
    measured: boolean;
  }[];
}

/**
 * The cost of a full build of an index: its entries, once per
 * representation that will be built, at the given rates. Seconds are
 * rounded up to a tenth; a representation without a positive rate costs
 * nothing measurable.
 */
export function estimateBuildCost(
  size: IndexContentSize,
  representations: readonly SearchRepresentation[],
  rates: Readonly<Record<SearchRepresentation, RepresentationRate>>,
): CostEstimate {
  const entries = size.selfEntries + size.relationEntries + size.passageEntries;
  const perRepresentation = representations.map((representation) => {
    const rate = rates[representation];
    const seconds = rate.entriesPerSecond > 0 ? tenths(entries / rate.entriesPerSecond) : 0;
    return { representation, entries, seconds, measured: rate.measured };
  });
  return {
    entities: size.entities,
    entries,
    seconds: tenths(perRepresentation.reduce((sum, r) => sum + r.seconds, 0)),
    perRepresentation,
  };
}

function tenths(seconds: number): number {
  // The epsilon keeps float noise (0.30000000000000004) from rounding up.
  return Math.ceil(Math.max(0, seconds * 10 - 1e-9)) / 10;
}
