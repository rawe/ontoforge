/**
 * Session-01 integration suite — requires the docker-compose Neo4j at
 * bolt://localhost:7687 (credentials per `src/config.ts` defaults).
 *
 * Covers: boot creates all constraints/indexes and is idempotent, wipe
 * empties the store, the features route through a fully booted app, and
 * the startup warning for stored types whose key is now reserved.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";

import { getDriver } from "../../src/adapters/neo4j/driver.js";
import { runSession } from "../../src/adapters/neo4j/errors.js";
import { closeStores, initStores, wipeDatabase } from "../../src/core/ports.js";
import { shutdownServer, startServer, warnAboutReservedTypeKeysInUse } from "../../src/main.js";

const EXPECTED_CONSTRAINTS = [
  "ontology_id_unique",
  "ontology_key_unique",
  "ontology_name_unique",
  "entity_type_id_unique",
  "entity_type_key_unique",
  "relation_type_id_unique",
  "relation_type_key_unique",
  "property_id_unique",
  "entity_instance_id_unique",
  "agent_config_id_unique",
  "saved_query_id_unique",
];

async function showNames(query: string): Promise<string[]> {
  return runSession(getDriver(), async (session) => {
    const result = await session.run(query);
    return result.records.map((record) => record.get("name") as string);
  });
}

async function assertSchemaObjectsPresent(): Promise<void> {
  const constraints = await showNames("SHOW CONSTRAINTS YIELD name RETURN name");
  for (const name of EXPECTED_CONSTRAINTS) {
    expect(constraints).toContain(name);
  }
  const indexes = await showNames("SHOW INDEXES YIELD name RETURN name");
  expect(indexes).toContain("entity_type_key_index");
}

afterAll(async () => {
  await closeStores();
});

describe("adapter boot", () => {
  it("creates all constraints and indexes, and is idempotent on second boot", async () => {
    await initStores();
    await assertSchemaObjectsPresent();

    await closeStores();
    await initStores(); // second boot against the already-constrained store
    await assertSchemaObjectsPresent();
  });

  it("wipe empties the store", async () => {
    await runSession(getDriver(), async (session) => {
      await session.run("CREATE (:WipeProbe {name: 'x'})");
    });
    await wipeDatabase();
    const count = await runSession(getDriver(), async (session) => {
      const result = await session.run("MATCH (n) RETURN count(n) AS c");
      return result.records[0]?.get("c") as number;
    });
    expect(count).toBe(0);
  });
});

describe("startup reserved-key report", () => {
  it("a stored type with a now-reserved key triggers the startup warning", async () => {
    // Seed directly via the driver: types that predate the reserved-key check.
    await runSession(getDriver(), async (session) => {
      await session.run(
        "CREATE (:EntityType {entityTypeId: 'et-legacy', key: 'ontology'})",
      );
      await session.run(
        "CREATE (:RelationType {relationTypeId: 'rt-legacy', key: 'has_property'})",
      );
    });
    await closeStores();

    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    });

    let app: FastifyInstance | null = null;
    try {
      app = await startServer(); // boot runs the report

      const reservedWarnings = warnings.filter((line) => line.includes("reserved key"));
      expect(reservedWarnings).toHaveLength(2);
      expect(reservedWarnings.some((w) => w.includes("EntityType 'ontology'"))).toBe(true);
      expect(
        reservedWarnings.some((w) => w.includes("RelationType 'has_property'")),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
      await wipeDatabase();
      if (app) {
        await shutdownServer(app);
      }
    }
  });

  it("reports nothing when no stored key is reserved", async () => {
    await initStores();
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    });
    try {
      await warnAboutReservedTypeKeysInUse();
      expect(warnings.filter((line) => line.includes("reserved key"))).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
      await closeStores();
    }
  });
});

describe("features route on a fully booted server", () => {
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
