/**
 * The one deliberate OQL divergence, Neo4j half.
 *
 * Type inference in OQL validation is pattern-local, so a property
 * accessed through a WITH alias is never checked against the lens
 * (`docs/capabilities/oql.md`). This adapter passes the access through
 * and Neo4j answers null; the PostgreSQL compiler refuses instead. Both
 * halves are pinned so neither drifts into the other unnoticed — the
 * other is `tests/integration/postgres/oql-alias-divergence.test.ts`.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { settings } from "../../../src/config.js";
import { closeStores, initStores } from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";
import { invalidateLoadedSchemaCache } from "../../../src/runtime/schemaCache.js";
import { buildFixture } from "../fixture.js";

type Row = Record<string, unknown>;

describe.skipIf(settings.DB_BACKEND !== "neo4j")("Neo4j WITH-alias access", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    invalidateLoadedSchemaCache();
    app = await createApp();
    await buildFixture(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/runtime/test_ontology/entities/person",
      payload: { name: "Alice", age: 30 },
    });
    expect(created.statusCode, created.body).toBe(201);
  });

  afterAll(async () => {
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  it("answers null for a property that resolves against no type in the lens", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/runtime/test_ontology/query",
      payload: { query: "MATCH (p:person) WITH p AS x RETURN x.bogus AS bogus" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Row).results).toEqual([{ bogus: null }]);
  });
});
