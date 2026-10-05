/**
 * The search pipeline's arithmetic: retry backoff, status derivation per
 * representation and per index, and the throughput moving average.
 */

import { describe, expect, it } from "vitest";

import type { SearchGenerationRecord, SearchQueueStats } from "../../src/core/ports.js";
import {
  backoffDelayMs,
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  DEFAULT_ENTRY_RATES,
  deriveIndexStatus,
  deriveRepresentationStatus,
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

function queue(generationId: string, pending: number, failed = 0, lastErrors: string[] = []): SearchQueueStats {
  return { generationId, pending, failed, lastErrors };
}

function input(parts: Partial<RepresentationStatusInput>): RepresentationStatusInput {
  return { representation: "keyword", enabled: true, available: true, generations: [], queue: [], ...parts };
}

describe("deriveRepresentationStatus", () => {
  it("ready: an active generation with nothing queued", () => {
    const status = deriveRepresentationStatus(input({ generations: [generation("g1", "ready")] }));
    expect(status).toMatchObject({ state: "ready", pending: 0, failed: 0, activeGenerationId: "g1" });
  });

  it("stale: the active generation has pending work", () => {
    const status = deriveRepresentationStatus(
      input({ generations: [generation("g1", "ready")], queue: [queue("g1", 3)] }),
    );
    expect(status).toMatchObject({ state: "stale", pending: 3 });
  });

  it("building: done/total from the backfill and what is still queued", () => {
    const status = deriveRepresentationStatus(
      input({
        generations: [generation("g1", "ready"), generation("g2", "building", 10)],
        queue: [queue("g2", 4)],
      }),
    );
    expect(status).toMatchObject({
      state: "building",
      done: 6,
      total: 10,
      activeGenerationId: "g1",
      buildingGenerationId: "g2",
    });
  });

  it("failed: items failed for good, with their last errors", () => {
    const ready = deriveRepresentationStatus(
      input({ generations: [generation("g1", "ready")], queue: [queue("g1", 0, 2, ["HTTP 500"])] }),
    );
    expect(ready).toMatchObject({ state: "failed", failed: 2, lastErrors: ["HTTP 500"] });
    const build = deriveRepresentationStatus(
      input({ generations: [generation("g2", "building", 5)], queue: [queue("g2", 0, 1, ["timeout"])] }),
    );
    expect(build).toMatchObject({ state: "failed", failed: 1, done: 4, total: 5 });
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

  it("collects the last errors of every representation once", () => {
    const status = deriveIndexStatus([
      { ...of("failed"), lastErrors: ["a", "b"] },
      { ...of("failed"), lastErrors: ["b"] },
    ]);
    expect(status.lastErrors).toEqual(["a", "b"]);
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
