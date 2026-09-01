/**
 * The Neo4j one-ontology cap, against the real database: the first
 * create succeeds, a second is rejected as a domain conflict (a clean
 * 409, never a storage error), and deleting the one ontology returns the
 * adapter to zero — physically empty graph — after which a create works
 * again. The raw node count reaches past the port on purpose; the
 * database-blind registry contract lives in
 * `tests/integration/ontology-registry.test.ts`.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDriver } from "../../../src/adapters/neo4j/driver.js";
import { runSession } from "../../../src/adapters/neo4j/errors.js";
import { createApp } from "../../../src/app.js";
import { settings } from "../../../src/config.js";
import { ConflictError, StoreError } from "../../../src/core/exceptions.js";
import { closeStores, getOntologyRegistry, initStores } from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let app: FastifyInstance;

async function nodeCount(): Promise<number> {
  return runSession(getDriver(), async (session) => {
    const result = await session.run("MATCH (n) RETURN count(n) AS c");
    return result.records[0]?.get("c") as number;
  });
}

describe.skipIf(settings.DB_BACKEND !== "neo4j")("Neo4j one-ontology cap", () => {
  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  beforeEach(async () => {
    await wipeDatabase();
  });

  it("port: first create succeeds, a second key is a domain conflict, delete reopens the slot", async () => {
    const registry = getOntologyRegistry();
    const first = await registry.createOntology(ID_A, "crm", null, null);
    expect(first.key).toBe("crm");

    const second = registry.createOntology(ID_B, "hr", null, null);
    await expect(second).rejects.toBeInstanceOf(ConflictError);
    await expect(second).rejects.not.toBeInstanceOf(StoreError);

    // The rejection changed nothing: the registry still lists exactly
    // the first ontology.
    const rows = await registry.listOntologies();
    expect(rows.map((row) => row.key)).toEqual(["crm"]);
    expect(await registry.getOntology("hr")).toBeNull();

    // Back to zero — the graph is physically empty, registry node
    // included — and the freed slot accepts the next create.
    expect(await registry.deleteOntology("crm")).toBe(true);
    expect(await registry.listOntologies()).toEqual([]);
    expect(await nodeCount()).toBe(0);

    const third = await registry.createOntology(ID_B, "hr", null, null);
    expect(third.key).toBe("hr");
  });

  it("REST: the second create answers a clean 409 naming no vendor", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/ontologies",
      payload: { key: "crm" },
    });
    expect(first.statusCode, first.body).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/ontologies",
      payload: { key: "hr" },
    });
    expect(second.statusCode).toBe(409);
    const body = second.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("RESOURCE_CONFLICT");
    expect(body.error.message).not.toMatch(/eo4j/);
    expect(body.error.message).not.toContain("_OntologyRegistry");

    const del = await app.inject({ method: "DELETE", url: "/api/ontologies/crm" });
    expect(del.statusCode).toBe(204);
    const third = await app.inject({
      method: "POST",
      url: "/api/ontologies",
      payload: { key: "hr" },
    });
    expect(third.statusCode, third.body).toBe(201);
  });

  it("delete cascades over a modeled and populated ontology, not just a bare one", async () => {
    await app.inject({ method: "POST", url: "/api/ontologies", payload: { key: "crm" } });
    const et = await app.inject({
      method: "POST",
      url: "/api/ontologies/crm/model/entity-types",
      payload: { key: "person", displayName: "Person" },
    });
    expect(et.statusCode, et.body).toBe(201);
    await app.inject({
      method: "POST",
      url: `/api/ontologies/crm/model/entity-types/${(et.json() as { entityTypeId: string }).entityTypeId}/properties`,
      payload: { key: "name", displayName: "Name", dataType: "string", required: true },
    });
    const lens = await app.inject({
      method: "POST",
      url: "/api/ontologies/crm/model/lenses",
      payload: { key: "default", name: "Default" },
    });
    expect(lens.statusCode, lens.body).toBe(201);
    const entity = await app.inject({
      method: "POST",
      url: "/api/ontologies/crm/runtime/lenses/default/entities/person",
      payload: { name: "Alice" },
    });
    expect(entity.statusCode, entity.body).toBe(201);

    const del = await app.inject({ method: "DELETE", url: "/api/ontologies/crm" });
    expect(del.statusCode).toBe(204);
    expect(await nodeCount()).toBe(0);
  });
});
