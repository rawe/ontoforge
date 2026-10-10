/**
 * The search pipeline's arithmetic: retry backoff, status derivation per
 * representation and per index, and the throughput moving average.
 */

import { describe, expect, it } from "vitest";

import type { SearchGenerationRecord, SearchQueueError, SearchQueueStats } from "../../src/core/ports.js";
import {
  backoffDelayMs,
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  DEFAULT_ENTRY_RATES,
  deriveIndexStatus,
  deriveRepresentationStatus,
  estimateBuildCost,
  MAX_LAST_ERRORS,
  ThroughputAverage,
  type RepresentationStatusInput,
  type SearchIndexState,
  type SearchRepresentationStatus,
} from "../../src/core/searchPipeline.js";

describe("backoffDelayMs", () => {
  it("doubles from the base per failed attempt, capped", () => {
    expect(backoffDelayMs(1)).toBe(BACKOFF_BASE_MS);
    expect(backoffDelayMs(2)).toBe(2 * BACKOFF_BASE_MS);
    expect(backoffDelayMs(4)).toBe(8 * BACKOFF_BASE_MS);
    expect(backoffDelayMs(20)).toBe(BACKOFF_CAP_MS);
    expect(backoffDelayMs(1000)).toBe(BACKOFF_CAP_MS);
  });

  it("is zero before any failure or with a zero base", () => {
    expect(backoffDelayMs(0)).toBe(0);
    expect(backoffDelayMs(3, 0)).toBe(0);
  });
});

function generation(
  generationId: string,
  state: SearchGenerationRecord["state"],
  total = 0,
): SearchGenerationRecord {
  return {
    generationId,
    searchIndexId: "index",
    representation: "keyword",
    definitionHash: "hash",
    modelId: null,
    dimensions: null,
    languages: ["english"],
    state,
    total,
    done: 0,
    failed: 0,
    createdAt: new Date(0),
    readyAt: null,
  };
}

function queue(generationId: string, pending: number, failed = 0, messages: string[] = []): SearchQueueStats {
  return { generationId, pending, failed, lastErrors: messages.map((message, i) => queueError(message, i)) };
}

/** A queue error `secondsAgo` seconds before a fixed instant. */
function queueError(message: string, secondsAgo = 0, entityId = "e1"): SearchQueueError {
  return { entityId, partKind: "entity", message, at: new Date(Date.UTC(2026, 0, 1, 12, 0, 0) - secondsAgo * 1000) };
}

function input(parts: Partial<RepresentationStatusInput>): RepresentationStatusInput {
  return { representation: "keyword", enabled: true, available: true, generations: [], queue: [], ...parts };
}

describe("deriveRepresentationStatus", () => {
  it("ready: an active generation with nothing queued", () => {
    const status = deriveRepresentationStatus(input({ generations: [generation("g1", "ready")] }));
    expect(status).toMatchObject({ state: "ready", build: null, pending: 0, failed: 0, activeGenerationId: "g1" });
  });

  it("stale: the active generation has pending work", () => {
    const status = deriveRepresentationStatus(
      input({ generations: [generation("g1", "ready")], queue: [queue("g1", 3)] }),
    );
    expect(status).toMatchObject({ state: "stale", build: null, pending: 3 });
  });

  it("building: build progress from the backfill and what is still queued", () => {
    const status = deriveRepresentationStatus(
      input({
        generations: [generation("g1", "ready"), generation("g2", "building", 10)],
        queue: [queue("g2", 4)],
      }),
    );
    expect(status).toMatchObject({
      state: "building",
      build: { done: 6, total: 10 },
      activeGenerationId: "g1",
      buildingGenerationId: "g2",
    });
  });

  it("failed: items failed for good, with their last errors", () => {
    const ready = deriveRepresentationStatus(
      input({ generations: [generation("g1", "ready")], queue: [queue("g1", 0, 2, ["HTTP 500"])] }),
    );
    expect(ready).toMatchObject({ state: "failed", failed: 2, lastErrors: [{ message: "HTTP 500" }] });
    const build = deriveRepresentationStatus(
      input({ generations: [generation("g2", "building", 5)], queue: [queue("g2", 0, 1, ["timeout"])] }),
    );
    expect(build).toMatchObject({ state: "failed", failed: 1, build: { done: 4, total: 5 } });
  });

  it("a build still retrying is building, not failed", () => {
    const status = deriveRepresentationStatus(
      input({ generations: [generation("g2", "building", 5)], queue: [queue("g2", 2, 1)] }),
    );
    expect(status.state).toBe("building");
  });

  it("disabled and unavailable win over any generation", () => {
    expect(deriveRepresentationStatus(input({ enabled: false })).state).toBe("disabled");
    expect(
      deriveRepresentationStatus(
        input({ representation: "semantic", available: false, generations: [generation("g1", "ready")] }),
      ).state,
    ).toBe("unavailable");
  });

  it("stale when no generation exists yet", () => {
    expect(deriveRepresentationStatus(input({})).state).toBe("stale");
  });
});

describe("deriveIndexStatus", () => {
  const base = deriveRepresentationStatus(input({}));
  const of = (state: SearchIndexState): SearchRepresentationStatus => ({ ...base, state });

  it("is the most severe state of the usable representations", () => {
    expect(deriveIndexStatus([of("ready"), of("stale")]).state).toBe("stale");
    expect(deriveIndexStatus([of("building"), of("stale")]).state).toBe("building");
    expect(deriveIndexStatus([of("failed"), of("building")]).state).toBe("failed");
    expect(deriveIndexStatus([of("ready"), of("unavailable")]).state).toBe("ready");
    expect(deriveIndexStatus([of("ready"), of("disabled")]).state).toBe("ready");
  });

  it("is unavailable when no representation is usable", () => {
    expect(deriveIndexStatus([of("disabled"), of("unavailable")]).state).toBe("unavailable");
  });

  it("collects the last errors of every representation once, newest first", () => {
    const status = deriveIndexStatus([
      { ...of("failed"), lastErrors: [queueError("a", 5), queueError("b", 3, "e2")] },
      { ...of("failed"), lastErrors: [queueError("b", 1, "e3")] },
    ]);
    expect(status.lastErrors.map((e) => [e.message, e.entityId])).toEqual([
      ["b", "e3"],
      ["a", "e1"],
    ]);
  });

  it("lists at most ten errors", () => {
    const errors = Array.from({ length: 14 }, (_, i) => queueError(`error ${i}`, i));
    const status = deriveIndexStatus([{ ...of("failed"), lastErrors: errors }]);
    expect(status.lastErrors).toHaveLength(MAX_LAST_ERRORS);
    expect(status.lastErrors[0]!.message).toBe("error 0");
  });
});

describe("ThroughputAverage", () => {
  it("is null until measured, then the first rate", () => {
    const average = new ThroughputAverage();
    expect(average.value).toBeNull();
    average.record(50, 2000);
    expect(average.value).toBe(25);
  });

  it("moves towards new measurements without jumping", () => {
    const average = new ThroughputAverage();
    average.record(10, 1000);
    average.record(20, 1000);
    expect(average.value).toBeCloseTo(13);
    average.record(20, 1000);
    expect(average.value).toBeCloseTo(15.1);
  });

  it("ignores measurements without entries or time", () => {
    const average = new ThroughputAverage();
    average.record(0, 1000);
    average.record(10, 0);
    expect(average.value).toBeNull();
  });

  it("has a default rate per representation for the cost preview", () => {
    expect(DEFAULT_ENTRY_RATES).toEqual({ keyword: 500, semantic: 20 });
  });
});

describe("estimateBuildCost", () => {
  const size = { entities: 100, selfEntries: 100, relationEntries: 250, passageEntries: 50 };
  const rates = {
    keyword: { entriesPerSecond: 500, measured: false },
    semantic: { entriesPerSecond: 16, measured: true },
  };

  it("counts self, relation and passage entries once per representation built", () => {
    expect(estimateBuildCost(size, ["keyword", "semantic"], rates)).toEqual({
      entities: 100,
      entries: 400,
      seconds: 25.8,
      perRepresentation: [
        { representation: "keyword", entries: 400, seconds: 0.8, measured: false },
        { representation: "semantic", entries: 400, seconds: 25, measured: true },
      ],
    });
  });

  it("costs only the representations that will be built", () => {
    const keywordOnly = estimateBuildCost(size, ["keyword"], rates);
    expect(keywordOnly.perRepresentation.map((r) => r.representation)).toEqual(["keyword"]);
    expect(keywordOnly.seconds).toBe(0.8);
  });

  it("rounds seconds up to a tenth and costs nothing without entries", () => {
    expect(estimateBuildCost({ ...size, selfEntries: 1, relationEntries: 0, passageEntries: 0 }, ["keyword"], rates).seconds).toBe(0.1);
    const empty = estimateBuildCost({ entities: 0, selfEntries: 0, relationEntries: 0, passageEntries: 0 }, ["keyword", "semantic"], rates);
    expect(empty).toMatchObject({ entities: 0, entries: 0, seconds: 0 });
  });

  it("uses the default rates the same way", () => {
    const defaults = {
      keyword: { entriesPerSecond: DEFAULT_ENTRY_RATES.keyword, measured: false },
      semantic: { entriesPerSecond: DEFAULT_ENTRY_RATES.semantic, measured: false },
    };
    expect(estimateBuildCost(size, ["semantic"], defaults).seconds).toBe(400 / DEFAULT_ENTRY_RATES.semantic);
  });
});
