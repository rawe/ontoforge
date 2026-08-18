/**
 * The one deliberate OQL divergence, PostgreSQL half.
 *
 * Type inference in OQL validation is pattern-local, so a variable
 * introduced by an intermediate projection has no known type and its
 * property accesses go unchecked (`docs/capabilities/oql.md`). This
 * compiler refuses there instead of yielding null: an unchecked access
 * through a WITH alias would let a query read past the lens. The
 * reference adapter's opposite half is pinned in
 * `tests/integration/neo4j/oql-alias-divergence.test.ts`, so neither
 * side can drift into the other unnoticed.
 *
 * The exact refusal wording is pinned DB-free in
 * `tests/adapters/postgres/oql.test.ts`; this is the end-to-end status.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { settings } from "../../../src/config.js";
import { closeStores, initStores, wipeDatabase } from "../../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../../src/runtime/schemaCache.js";
import { buildFixture } from "../fixture.js";

type Row = Record<string, unknown>;

describe.skipIf(settings.DB_BACKEND !== "postgres")("PostgreSQL WITH-alias access", () => {
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

  async function query(oql: string): Promise<{ status: number; body: Row }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/runtime/test_ontology/query",
      payload: { query: oql },
    });
    return { status: res.statusCode, body: res.json() as Row };
  }

  it("refuses a property that resolves against no type in the lens", async () => {
    const { status, body } = await query("MATCH (p:person) WITH p AS x RETURN x.bogus");
    expect(status).toBe(422);
    const errors = ((body.error as Row).details as Row).errors as string[];
    expect(errors[0]).toContain("Unknown property 'bogus' on entity type 'person'");
  });

  it("still answers an access the alias's own type resolves", async () => {
    const { status, body } = await query("MATCH (p:person) WITH p AS x RETURN x.name AS name");
    expect(status).toBe(200);
    expect(body.results).toEqual([{ name: "Alice" }]);
  });
});
