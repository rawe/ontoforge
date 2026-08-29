/**
 * Skeleton contract, database-blind — runs against whichever adapter
 * `DB_BACKEND` selects. Covers: the adapter lifecycle (close→init cycle,
 * idempotent close) and the features/docs routes on a fully booted
 * server.
 *
 * The Neo4j-physical assertions (constraint/index names, raw seeding, raw
 * wipe probe) live in `tests/integration/neo4j/skeleton.test.ts`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeStores,
  getModelingStore,
  initStores,
} from "../../src/core/ports.js";
import { wipeDatabase } from "./reset.js";
import { shutdownServer, startServer } from "../../src/main.js";

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
});

beforeEach(async () => {
  await wipeDatabase();
});

afterAll(async () => {
  await wipeDatabase();
  await closeStores();
});

describe("adapter lifecycle", () => {
  it("survives a close→init cycle, and close is idempotent", async () => {
    await closeStores();
    await closeStores(); // the port contract's "Close. Idempotent."
    await initStores(); // boot again against the same store
    expect(await getModelingStore().listLenses()).toEqual([]);
  });
});

describe("features route on a fully booted server", () => {
  // `startServer` boots its own adapter; bracket the file-global stores
  // around each test so both lifecycles stay single-owner.
  beforeEach(async () => {
    await closeStores();
  });

  afterEach(async () => {
    await initStores();
  });

  it("answers both capabilities false with the exact field names", async () => {
    const app = await startServer();
    try {
      const res = await app.inject({ method: "GET", url: "/api/runtime/features" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ semanticSearch: false, ai: false });
    } finally {
      await shutdownServer(app);
    }
  });

  it("serves /openapi.json and /docs", async () => {
    const app = await startServer();
    try {
      const spec = await app.inject({ method: "GET", url: "/openapi.json" });
      expect(spec.statusCode).toBe(200);
      expect(spec.json().info.title).toBe("OntoForge");

      const docs = await app.inject({ method: "GET", url: "/docs" });
      expect([200, 302]).toContain(docs.statusCode);
    } finally {
      await shutdownServer(app);
    }
  });
});
