/**
 * Ontology registry conformance — the registry port operations and the
 * REST registry CRUD at `/api/ontologies` against the real database:
 * lifecycle (bare create, rename = display name only, hard cascade
 * delete, recreate after delete), both server-wide uniqueness
 * dimensions, the 59-char key cap at its physical edge, and zero
 * ontologies as a valid served state.
 *
 * Gated to PostgreSQL: the Neo4j adapter does not implement the registry
 * port yet — when its one-ontology-capped registry lands, this file's
 * contract tier runs on both backends and only the multi-ontology cases
 * stay PostgreSQL-gated.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { settings } from "../../src/config.js";
import { closeStores, getOntologyRegistry, initStores } from "../../src/core/ports.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, unknown>;

let app: FastifyInstance;

describe.skipIf(settings.DB_BACKEND !== "postgres")("ontology registry", () => {
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

  async function createOntology(payload: Row): Promise<Row> {
    const res = await app.inject({ method: "POST", url: "/api/ontologies", payload });
    expect(res.statusCode, `POST /api/ontologies: ${res.body}`).toBe(201);
    return res.json() as Row;
  }

  describe("zero ontologies", () => {
    it("a fresh server serves an empty registry", async () => {
      const res = await app.inject({ method: "GET", url: "/api/ontologies" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("the last ontology is deletable — the server returns to zero", async () => {
      await createOntology({ key: "only_one" });
      const del = await app.inject({ method: "DELETE", url: "/api/ontologies/only_one" });
      expect(del.statusCode).toBe(204);
      const list = await app.inject({ method: "GET", url: "/api/ontologies" });
      expect(list.json()).toEqual([]);
    });
  });

  describe("create", () => {
    it("creates bare, reads back by key, and lists", async () => {
      const created = await createOntology({ key: "crm", displayName: "Customer Relations" });
      expect(created.key).toBe("crm");
      expect(created.displayName).toBe("Customer Relations");
      expect(created.ontologyId).toMatch(/^[0-9a-f-]{36}$/);

      const read = await app.inject({ method: "GET", url: "/api/ontologies/crm" });
      expect(read.statusCode).toBe(200);
      expect(read.json()).toEqual(created);

      const list = await app.inject({ method: "GET", url: "/api/ontologies" });
      expect(list.json()).toEqual([created]);
    });

    it("several ontologies may all lack a display name", async () => {
      const first = await createOntology({ key: "first" });
      const second = await createOntology({ key: "second" });
      expect(first.displayName).toBeNull();
      expect(second.displayName).toBeNull();
    });

    it("a duplicate key answers 409 and leaves the original untouched", async () => {
      const original = await createOntology({ key: "crm", displayName: "Customer Relations" });
      const res = await app.inject({
        method: "POST",
        url: "/api/ontologies",
        payload: { key: "crm", displayName: "Something Else" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
      const read = await app.inject({ method: "GET", url: "/api/ontologies/crm" });
      expect(read.json()).toEqual(original);
    });

    it("a duplicate display name answers 409", async () => {
      await createOntology({ key: "crm", displayName: "Customer Relations" });
      const res = await app.inject({
        method: "POST",
        url: "/api/ontologies",
        payload: { key: "other", displayName: "Customer Relations" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
    });

    it("a 59-character key works end to end at the physical edge", async () => {
      const key59 = `k${"x".repeat(58)}`;
      const created = await createOntology({ key: key59 });
      expect(created.key).toBe(key59);
      const del = await app.inject({ method: "DELETE", url: `/api/ontologies/${key59}` });
      expect(del.statusCode).toBe(204);
    });

    it("a 60-character key dies as a clean 422", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ontologies",
        payload: { key: `k${"x".repeat(59)}` },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("rename", () => {
    it("changes the display name only; the key never changes", async () => {
      const created = await createOntology({ key: "crm", displayName: "Customer Relations" });
      const res = await app.inject({
        method: "PATCH",
        url: "/api/ontologies/crm",
        payload: { displayName: "Sales" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.key).toBe("crm");
      expect(body.displayName).toBe("Sales");
      expect(body.ontologyId).toBe(created.ontologyId);
      expect(body.createdAt).toBe(created.createdAt);
    });

    it("gives a nameless ontology its first display name", async () => {
      await createOntology({ key: "crm" });
      const res = await app.inject({
        method: "PATCH",
        url: "/api/ontologies/crm",
        payload: { displayName: "Customer Relations" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().displayName).toBe("Customer Relations");
    });

    it("a display name held by another ontology answers 409", async () => {
      await createOntology({ key: "crm", displayName: "Customer Relations" });
      await createOntology({ key: "hr", displayName: "Human Resources" });
      const res = await app.inject({
        method: "PATCH",
        url: "/api/ontologies/hr",
        payload: { displayName: "Customer Relations" },
      });
      expect(res.statusCode).toBe(409);
    });

    it("an unknown key answers 404", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/ontologies/nope",
        payload: { displayName: "Anything" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("delete", () => {
    it("removes the ontology; the key answers 404 afterwards", async () => {
      await createOntology({ key: "crm" });
      const del = await app.inject({ method: "DELETE", url: "/api/ontologies/crm" });
      expect(del.statusCode).toBe(204);
      const read = await app.inject({ method: "GET", url: "/api/ontologies/crm" });
      expect(read.statusCode).toBe(404);
    });

    it("recreating a deleted key works — and frees its display name", async () => {
      await createOntology({ key: "crm", displayName: "Customer Relations" });
      await app.inject({ method: "DELETE", url: "/api/ontologies/crm" });
      const again = await createOntology({ key: "crm", displayName: "Customer Relations" });
      expect(again.key).toBe("crm");
      expect(again.displayName).toBe("Customer Relations");
    });

    it("an unknown key answers 404", async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/ontologies/nope" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("registry port operations", () => {
    const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    it("createOntology returns the port row shape and getOntology round-trips it", async () => {
      const registry = getOntologyRegistry();
      const created = await registry.createOntology(ID_A, "crm", "Customer Relations", null);
      expect(created.ontologyId).toBe(ID_A);
      expect(created.key).toBe("crm");
      expect(created.displayName).toBe("Customer Relations");
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.updatedAt).toBeInstanceOf(Date);

      const read = await registry.getOntology("crm");
      expect(read).toEqual(created);
      expect(await registry.getOntology("nope")).toBeNull();
    });

    it("getOntologyByDisplayName finds by the other uniqueness dimension", async () => {
      const registry = getOntologyRegistry();
      await registry.createOntology(ID_A, "crm", "Customer Relations", null);
      const found = await registry.getOntologyByDisplayName("Customer Relations");
      expect(found?.key).toBe("crm");
      expect(await registry.getOntologyByDisplayName("Nope")).toBeNull();
    });

    it("listOntologies orders by key", async () => {
      const registry = getOntologyRegistry();
      await registry.createOntology(ID_B, "zeta", null, null);
      await registry.createOntology(ID_A, "alpha", null, null);
      const rows = await registry.listOntologies();
      expect(rows.map((row) => row.key)).toEqual(["alpha", "zeta"]);
    });

    it("renameOntology updates the display name, null for an unknown key", async () => {
      const registry = getOntologyRegistry();
      await registry.createOntology(ID_A, "crm", null, null);
      const renamed = await registry.renameOntology("crm", "Sales");
      expect(renamed?.displayName).toBe("Sales");
      expect(await registry.renameOntology("nope", "Anything")).toBeNull();
    });

    it("deleteOntology answers true once and false for a gone key", async () => {
      const registry = getOntologyRegistry();
      await registry.createOntology(ID_A, "crm", null, null);
      expect(await registry.deleteOntology("crm")).toBe(true);
      expect(await registry.deleteOntology("crm")).toBe(false);
      expect(await registry.getOntology("crm")).toBeNull();
    });
  });
});
