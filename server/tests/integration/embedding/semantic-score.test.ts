/**
 * The pinned semantic-search similarity, asserted with fixed vectors
 * against whichever adapter is configured.
 *
 * Every backend must answer the same number for the same pair of
 * vectors: `(1 + cosine) / 2` — [0,1], higher-better, what
 * `docs/capabilities/search.md` calls the raw cosine similarity. The
 * arithmetic is self-verifying — a vector scored against itself is 1, an
 * orthogonal one 0.5, its own negation 0, and direction alone decides,
 * never magnitude. `minScore` is asserted here too, because where the
 * floor sits (after the limit, so a page may shrink) is part of the same
 * contract.
 *
 * No text is embedded here: the probe vectors are written straight
 * through the port. The case still lives in the embedding suite because
 * the vector indexes it shares are sized by the configured model, and
 * the model's width is the only width every index in reach agrees on.
 * Its own index is rebuilt rather than created, so a leftover of another
 * width cannot decide the outcome.
 *
 * The probe vectors are ±1 patterns across the full width rather than a
 * handful of coordinates: a vector index may quantize what it stores, and
 * a two-coordinate probe then drifts by up to half a point, while these
 * patterns survive quantization exactly on both backends. Real
 * embeddings behave like the patterns — the drift is an artefact of very
 * low-dimensional test vectors.
 */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getEmbeddingProvider } from "../../../src/core/embedding.js";
import {
  closeStores,
  getModelingStore,
  getOntologyRegistry,
  getRuntimeStore,
  initStores,
} from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";
import type { PropertyDef } from "../../../src/core/schemas.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "./support.js";

type Row = Record<string, unknown>;

const ollamaUp = await checkOllamaModel();

const TYPE_KEY = "vector_probe";

/** The configured model's width — the width every vector index in reach
 * is built at. Filled in once the provider is enabled. */
let width = 0;

/** A vector with `plus` components at `+scale` and the rest at `-scale`.
 * Its cosine against `query()` is `(2 * plus - width) / width`, whatever
 * the scale. */
function pattern(plus: number, scale = 1): number[] {
  return Array.from({ length: width }, (_, i) => (i < plus ? scale : -scale));
}

/** The vector every case is scored against: all components +1. */
function query(): number[] {
  return pattern(width);
}

/** One stored vector per pinned similarity, as a fraction of the width. */
const CASES = [
  { name: "identical", plus: 1, scale: 1, similarity: 1 }, // cosine 1
  { name: "slanted", plus: 0.875, scale: 1, similarity: 0.875 }, // cosine 0.75
  { name: "scaled", plus: 0.875, scale: 3, similarity: 0.875 }, // same direction, ×3
  { name: "orthogonal", plus: 0.5, scale: 1, similarity: 0.5 }, // cosine 0
  { name: "opposite", plus: 0, scale: 1, similarity: 0 }, // cosine -1
];

const DEFS: Record<string, PropertyDef> = {
  name: {
    key: "name",
    displayName: "Name",
    description: null,
    dataType: "string",
    required: true,
    defaultValue: null,
  },
};

async function search(limit: number, minScore: number | null): Promise<Row[]> {
  const runtime = await getRuntimeStore("score_probe");
  return runtime.semanticSearch(TYPE_KEY, DEFS, query(), limit, minScore);
}

describe.skipIf(!ollamaUp)("semantic-search score", () => {
  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    enableOllamaProvider();
    width = getEmbeddingProvider()!.dimensions;

    await getOntologyRegistry().createOntology(randomUUID(), "score_probe", null, width);
    const modeling = await getModelingStore("score_probe");
    const entityTypeId = randomUUID();
    await modeling.createEntityType(entityTypeId, TYPE_KEY, "Vector Probe", null);
    await modeling.createProperty(
      entityTypeId,
      "EntityType",
      randomUUID(),
      "name",
      "Name",
      null,
      "string",
      true,
      null,
    );
    await modeling.rebuildVectorIndex(TYPE_KEY, width);

    const runtime = await getRuntimeStore("score_probe");
    for (const testCase of CASES) {
      await runtime.createEntity(
        TYPE_KEY,
        randomUUID(),
        { name: testCase.name },
        DEFS,
        pattern(Math.round(testCase.plus * width), testCase.scale),
      );
    }
    // Nothing to wait for: a write that has returned is searchable. The
    // port commits the vector with the entity, and every backend indexes
    // it in that same transaction.
  });

  afterAll(async () => {
    disableProvider();
    await wipeDatabase();
    await closeStores();
  });

  it("scores fixed vectors at the pinned similarity", async () => {
    const hits = await search(10, null);
    expect(hits).toHaveLength(CASES.length);

    const scored = new Map(
      hits.map((hit) => [(hit.entity as Row).name as string, hit.score as number]),
    );
    for (const testCase of CASES) {
      expect(scored.get(testCase.name), `similarity of '${testCase.name}'`).toBeCloseTo(
        testCase.similarity,
        5,
      );
    }
  });

  it("orders hits by descending similarity", async () => {
    const hits = await search(10, null);
    const scores = hits.map((hit) => hit.score as number);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect((hits[0]!.entity as Row).name).toBe("identical");
  });

  it("drops every hit below minScore", async () => {
    const hits = await search(10, 0.9);
    expect(hits.map((hit) => (hit.entity as Row).name)).toEqual(["identical"]);
  });

  it("applies minScore after the limit, so the page may shrink", async () => {
    // The floor sits outside the scan: a limit of three takes the three
    // best vectors and the floor then removes two of them. It never
    // scans further to refill the page.
    const hits = await search(3, 0.9);
    expect(hits.map((hit) => (hit.entity as Row).name)).toEqual(["identical"]);
  });
});
