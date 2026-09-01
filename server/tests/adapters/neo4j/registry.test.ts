/**
 * The capped Neo4j ontology registry, at the adapter seam with a fake
 * driver: the one-ontology cap rejects a second create as a domain
 * conflict (never a storage error), rows cross the port with driver
 * temporals converted and an absent display name as null, and delete
 * takes the whole graph with it.
 *
 * The live behaviour — real graph, real indexes — is covered by the
 * contract tier of the integration suite and by
 * `tests/integration/neo4j/registry-cap.test.ts`.
 */

import type { Driver } from "neo4j-driver";
import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";

import { Neo4jOntologyRegistry } from "../../../src/adapters/neo4j/registry.js";
import { ConflictError, StoreError } from "../../../src/core/exceptions.js";

type Row = Record<string, unknown>;

interface FakeResult {
  records: { get: (key: string) => unknown }[];
}

function toResult(rows: Row[]): FakeResult {
  return { records: rows.map((row) => ({ get: (key: string) => row[key] })) };
}

/** A fake driver that dispatches on query text and records every query. */
function fakeDriver(
  respond: (query: string) => Row[],
): { driver: Driver; queries: string[] } {
  const queries: string[] = [];
  const driver = {
    session: () => ({
      run: async (query: string) => {
        queries.push(query);
        return toResult(respond(query));
      },
      close: async () => undefined,
    }),
  } as unknown as Driver;
  return { driver, queries };
}

describe("the one-ontology cap", () => {
  it("a second create is rejected as a domain conflict, never a storage error", async () => {
    // The conditional create returns no row: the registry already holds
    // its one ontology.
    const { driver } = fakeDriver(() => []);
    const registry = new Neo4jOntologyRegistry(driver);

    const promise = registry.createOntology(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "second",
      null,
      null,
    );
    await expect(promise).rejects.toBeInstanceOf(ConflictError);
    await expect(promise).rejects.not.toBeInstanceOf(StoreError);

    const message = await promise.catch((e: Error) => e.message);
    expect(message).toMatch(/one ontology|single ontology/i);
    // The domain condition leaks nothing physical.
    expect(message).not.toMatch(/eo4j/);
    expect(message).not.toContain("_OntologyRegistry");
    expect(message).not.toContain("label");
  });

  it("a rejected create touches nothing — no index DDL, no write", async () => {
    // The registry already holds its one ontology.
    const { driver, queries } = fakeDriver((query) =>
      query.includes("count(r)") ? [{ registered: 1 }] : [],
    );
    const registry = new Neo4jOntologyRegistry(driver);

    await expect(
      registry.createOntology("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "second", null, 768),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(queries.some((q) => q.includes("CREATE VECTOR INDEX"))).toBe(false);
    expect(queries.some((q) => q.includes("CREATE ("))).toBe(false);
  });
});

describe("port row shape", () => {
  it("rows cross the port with temporals as Date and an absent display name as null", async () => {
    const createdAt = neo4j.types.DateTime.fromStandardDate(
      new Date("2026-08-30T10:00:00.000Z"),
    );
    // The stored node carries no displayName property — Neo4j stores no
    // null property values.
    const node: Row = {
      ontologyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      key: "crm",
      createdAt,
      updatedAt: createdAt,
    };
    const { driver } = fakeDriver((query) =>
      query.includes("CREATE") || query.includes("MATCH (r:") ? [{ ontology: node }] : [],
    );
    const registry = new Neo4jOntologyRegistry(driver);

    const created = await registry.createOntology(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "crm",
      null,
      null,
    );
    expect(created.displayName).toBeNull();
    expect(created.createdAt).toBeInstanceOf(Date);
    expect((created.createdAt as Date).toISOString()).toBe("2026-08-30T10:00:00.000Z");

    const read = await registry.getOntology("crm");
    expect(read).toEqual(created);
  });
});

describe("delete — the hard cascade at scale one", () => {
  it("an unknown key answers false and deletes nothing", async () => {
    const { driver, queries } = fakeDriver(() => []);
    const registry = new Neo4jOntologyRegistry(driver);

    expect(await registry.deleteOntology("nope")).toBe(false);
    expect(queries.some((q) => q.includes("DELETE"))).toBe(false);
    expect(queries.some((q) => q.includes("DROP"))).toBe(false);
  });

  it("takes every node and every vector index; the boot constraints stay", async () => {
    const { driver, queries } = fakeDriver((query) => {
      if (query.includes("RETURN r.key")) {
        return [{ key: "crm" }];
      }
      if (query.includes("SHOW VECTOR INDEXES")) {
        return [{ name: "entity_embedding" }, { name: "person_embedding" }];
      }
      return [];
    });
    const registry = new Neo4jOntologyRegistry(driver);

    expect(await registry.deleteOntology("crm")).toBe(true);
    expect(queries).toContain("MATCH (n) DETACH DELETE n");
    const drops = queries.filter((q) => q.startsWith("DROP INDEX"));
    expect(drops).toEqual([
      "DROP INDEX `entity_embedding` IF EXISTS",
      "DROP INDEX `person_embedding` IF EXISTS",
    ]);
    expect(queries.some((q) => q.includes("DROP CONSTRAINT"))).toBe(false);
  });
});
