/**
 * The `isUuid()` guard on the PostgreSQL modeling store.
 *
 * Every schema-side PK is a `uuid` column, but ids arrive as unvalidated
 * wire strings. Each id-taking method passes them through a strict
 * syntactic check first — exactly the format the server itself generates,
 * lowercase hyphenated 8-4-4-4-12 — and off-format input short-circuits
 * to the method's not-found shape without touching the database. This
 * reproduces the reference adapter's observable not-found behaviour
 * (where ids are compared as strings) and keeps 22P02 unreachable from
 * caller input: PostgreSQL's own more lenient uuid parsing (uppercase,
 * braces, no hyphens) would otherwise FIND rows where a string
 * comparison answers not-found.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initPool } from "../../../src/adapters/postgres/errors.js";
import { PostgresModelingStore } from "../../../src/adapters/postgres/modelingStore.js";
import { fakeDb } from "./support.js";

vi.mock("pg", async (importOriginal) => {
  const { fakePgModule } = await import("./support.js");
  return fakePgModule(await importOriginal());
});

const VALID = "4f2d8a31-1111-4222-8333-444455556666";

const store = new PostgresModelingStore();

beforeAll(async () => {
  await initPool();
});

beforeEach(() => {
  fakeDb.reset();
});

describe("off-format ids short-circuit to the not-found shape, database untouched", () => {
  const OFF_FORMAT = [
    "not-a-uuid",
    "4F2D8A31-1111-4222-8333-444455556666", // uppercase: PG would accept it
    "{4f2d8a31-1111-4222-8333-444455556666}", // braces: PG would accept it
    "4f2d8a31111142228333444455556666", // no hyphens: PG would accept it
    "",
  ];

  it.each(OFF_FORMAT)("point reads answer null for '%s'", async (id) => {
    expect(await store.getLens(id)).toBeNull();
    expect(await store.getEntityType(id)).toBeNull();
    expect(await store.getRelationType(id)).toBeNull();
    expect(await store.getProperty(VALID, "EntityType", id)).toBeNull();
    expect(fakeDb.queries).toEqual([]);
  });

  it("updates answer null", async () => {
    expect(await store.updateLens("nope", "n", null)).toBeNull();
    expect(await store.updateEntityType("nope", "n", null)).toBeNull();
    expect(await store.updateRelationType("nope", "n", null)).toBeNull();
    expect(await store.updateProperty("nope", "EntityType", VALID, "n", null, null, null, false)).toBeNull();
    expect(await store.updateProperty(VALID, "EntityType", "nope", "n", null, null, null, false)).toBeNull();
    expect(fakeDb.queries).toEqual([]);
  });

  it("deletes answer false", async () => {
    expect(await store.deleteLens("nope")).toBe(false);
    expect(await store.deleteEntityType("nope")).toBe(false);
    expect(await store.deleteRelationType("nope")).toBe(false);
    expect(await store.deleteProperty("nope", "EntityType", VALID)).toBe(false);
    expect(await store.deleteProperty(VALID, "RelationType", "nope")).toBe(false);
    expect(await store.deleteAiAgent("nope", "agent")).toBe(false);
    expect(await store.deleteSavedQuery("nope", "query")).toBe(false);
    expect(fakeDb.queries).toEqual([]);
  });

  it("owner-scoped lookups answer their empty shapes", async () => {
    expect(await store.listProperties("nope", "EntityType")).toEqual([]);
    expect(await store.getPropertyByKey("nope", "EntityType", "name")).toBeNull();
    expect(await store.isEntityTypeReferenced("nope")).toBe(false);
    expect(await store.listAiAgents("nope")).toEqual([]);
    expect(await store.listAiAgentsForExport("nope")).toEqual([]);
    expect(await store.listSavedQueries("nope")).toEqual([]);
    expect(await store.listSavedQueriesForExport("nope")).toEqual([]);
    expect(fakeDb.queries).toEqual([]);
  });

  it("inclusion operations answer null / false / empty / zero", async () => {
    expect(await store.addIncludesType("nope", "EntityType", "person", null)).toBeNull();
    expect(await store.listIncludesTypes("nope", "EntityType")).toEqual([]);
    expect(await store.updateIncludesType("nope", "EntityType", VALID, null)).toBeNull();
    expect(await store.updateIncludesType(VALID, "EntityType", "nope", null)).toBeNull();
    expect(await store.removeIncludesType(VALID, "RelationType", "nope")).toBe(false);
    expect(await store.removeAllIncludesForType("EntityType", "nope")).toBe(0);
    expect(await store.findLensesIncludingType("EntityType", "nope")).toEqual([]);
    expect(await store.findLensesWithExplicitProperty("EntityType", "nope", "p")).toEqual([]);
    expect(await store.addPropertyToIncludesLists("EntityType", "nope", "p")).toBe(0);
    expect(await store.removePropertyFromIncludesLists("EntityType", "nope", "p")).toBe(0);
    expect(fakeDb.queries).toEqual([]);
  });

  it("embedding writes resolve as silent no-ops", async () => {
    await store.setEntityEmbedding("nope", [0.1, 0.2]);
    await store.setSavedQueryEmbedding("nope", [0.1, 0.2]);
    expect(fakeDb.queries).toEqual([]);
  });
});

describe("well-formed ids reach the database", () => {
  it("a lowercase hyphenated uuid issues the query", async () => {
    expect(await store.getLens(VALID)).toBeNull(); // empty fake result
    expect(fakeDb.queries).toHaveLength(1);
    expect(fakeDb.queries[0]?.params).toEqual([VALID]);
  });
});
