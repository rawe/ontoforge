/**
 * Session-03 integration suite — lenses, inclusions, the cascade
 * protocol and validation against the docker-compose Neo4j at
 * bolt://localhost:7687.
 *
 * Covers: lens CRUD with both uniqueness dimensions, the inclusion
 * lifecycle with the absent-vs-empty allowlist distinction preserved by
 * real storage, upsert-on-re-add, the ordering hazard end-to-end, every
 * cascade trigger and repair end-to-end, property-delete cleanup, and
 * schema validation answering valid over a clean schema.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { wipeDatabase } from "./reset.js";

let app: FastifyInstance;

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

async function createEntityType(key: string, displayName: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/model/entity-types",
    payload: { key, displayName },
  });
  expect(res.statusCode).toBe(201);
  return res.json().entityTypeId as string;
}

async function createRelationType(
  key: string,
  sourceKey: string,
  targetKey: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/model/relation-types",
    payload: {
      key,
      displayName: key,
      sourceEntityTypeKey: sourceKey,
      targetEntityTypeKey: targetKey,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().relationTypeId as string;
}

async function createLens(key: string, name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/model/lenses",
    payload: { key, name },
  });
  expect(res.statusCode).toBe(201);
  return res.json().lensId as string;
}

async function addProperty(
  entityTypeId: string,
  key: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/model/entity-types/${entityTypeId}/properties`,
    payload: { key, displayName: key, dataType: "string", ...extra },
  });
  expect(res.statusCode).toBe(201);
  return res.json().propertyId as string;
}

describe("lens round trip", () => {
  it("create, read, list, update, delete", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/model/lenses",
      payload: { key: "hr", name: "Human Resources", description: "People stuff" },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.key).toBe("hr");
    expect(body.name).toBe("Human Resources");
    expect(body.lensId).toMatch(/^[0-9a-f-]{36}$/);

    const read = await app.inject({
      method: "GET",
      url: `/api/model/lenses/${body.lensId}`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(body);

    const list = await app.inject({ method: "GET", url: "/api/model/lenses" });
    expect(list.json()).toHaveLength(1);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/model/lenses/${body.lensId}`,
      payload: { name: "People" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe("People");
    expect(updated.json().key).toBe("hr"); // immutable
    expect(updated.json().description).toBe("People stuff"); // sparse

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/model/lenses/${body.lensId}`,
    });
    expect(deleted.statusCode).toBe(204);
    const gone = await app.inject({
      method: "GET",
      url: `/api/model/lenses/${body.lensId}`,
    });
    expect(gone.statusCode).toBe(404);
  });

  it("key and name are each globally unique", async () => {
    await createLens("hr", "Human Resources");

    const dupKey = await app.inject({
      method: "POST",
      url: "/api/model/lenses",
      payload: { key: "hr", name: "Different Name" },
    });
    expect(dupKey.statusCode).toBe(409);
    expect(dupKey.json().error.message).toContain("key 'hr'");

    const dupName = await app.inject({
      method: "POST",
      url: "/api/model/lenses",
      payload: { key: "different_key", name: "Human Resources" },
    });
    expect(dupName.statusCode).toBe(409);
    expect(dupName.json().error.message).toContain("name 'Human Resources'");
  });

  it("lens deletion leaves schema and other lenses untouched", async () => {
    const etId = await createEntityType("person", "Person");
    const lensA = await createLens("lens_a", "Lens A");
    const lensB = await createLens("lens_b", "Lens B");
    await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensA}/includes/entity-types`,
      payload: { key: "person" },
    });
    await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensB}/includes/entity-types`,
      payload: { key: "person" },
    });

    const deleted = await app.inject({ method: "DELETE", url: `/api/model/lenses/${lensA}` });
    expect(deleted.statusCode).toBe(204);

    const et = await app.inject({ method: "GET", url: `/api/model/entity-types/${etId}` });
    expect(et.statusCode).toBe(200);
    const bInclusions = await app.inject({
      method: "GET",
      url: `/api/model/lenses/${lensB}/includes/entity-types`,
    });
    expect(bInclusions.json()).toHaveLength(1);
  });
});

describe("inclusion lifecycle against real storage", () => {
  it("absent and empty allowlists survive the round trip as distinct states", async () => {
    await createEntityType("person", "Person");
    await createEntityType("company", "Company");
    const lensId = await createLens("hr", "Human Resources");

    const absent = await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/includes/entity-types`,
      payload: { key: "person" },
    });
    expect(absent.statusCode).toBe(201);
    expect(absent.json().properties).toBeNull();

    const empty = await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/includes/entity-types`,
      payload: { key: "company", properties: [] },
    });
    expect(empty.statusCode).toBe(201);
    expect(empty.json().properties).toEqual([]);

    const list = await app.inject({
      method: "GET",
      url: `/api/model/lenses/${lensId}/includes/entity-types`,
    });
    const rows = list.json() as { key: string; properties: string[] | null }[];
    expect(rows.find((r) => r.key === "person")?.properties).toBeNull();
    expect(rows.find((r) => r.key === "company")?.properties).toEqual([]);
  });

  it("re-adding the same type is an upsert that replaces the allowlist", async () => {
    const etId = await createEntityType("person", "Person");
    await addProperty(etId, "full_name");
    const lensId = await createLens("hr", "Human Resources");

    await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/includes/entity-types`,
      payload: { key: "person", properties: ["full_name"] },
    });
    const again = await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/includes/entity-types`,
      payload: { key: "person" },
    });
    expect(again.statusCode).toBe(201); // not a conflict
    expect(again.json().properties).toBeNull();

    const list = await app.inject({
      method: "GET",
      url: `/api/model/lenses/${lensId}/includes/entity-types`,
    });
    expect(list.json()).toHaveLength(1); // still one inclusion per (lens, type)
    expect(list.json()[0].properties).toBeNull();
  });

  it("update by internal id in the path replaces the allowlist; remove drops it", async () => {
    const etId = await createEntityType("person", "Person");
    await addProperty(etId, "full_name");
    await addProperty(etId, "age");
    const lensId = await createLens("hr", "Human Resources");
    await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/includes/entity-types`,
      payload: { key: "person" },
    });

    const updated = await app.inject({
      method: "PUT",
      url: `/api/model/lenses/${lensId}/includes/entity-types/${etId}`,
      payload: { properties: ["full_name"] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().properties).toEqual(["full_name"]);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/model/lenses/${lensId}/includes/entity-types/${etId}`,
    });
    expect(removed.statusCode).toBe(204);
    const list = await app.inject({
      method: "GET",
      url: `/api/model/lenses/${lensId}/includes/entity-types`,
    });
    expect(list.json()).toHaveLength(0);
  });

  it("the ordering hazard end-to-end: relation first, entities later, validation reports it", async () => {
    await createEntityType("person", "Person");
    await createEntityType("company", "Company");
    await createRelationType("works_for", "person", "company");
    const lensId = await createLens("hr", "Human Resources");

    // Relation inclusion first — no entity inclusions yet, accepted unchecked.
    const rel = await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/includes/relation-types`,
      payload: { key: "works_for" },
    });
    expect(rel.statusCode).toBe(201);

    // Now scope entities to person only — works_for's target is not exposed.
    await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/includes/entity-types`,
      payload: { key: "person" },
    });

    const validation = await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/validate`,
    });
    expect(validation.statusCode).toBe(200);
    const body = validation.json();
    expect(body.valid).toBe(false);
    expect(body.errors).toEqual([
      {
        path: "lenses.hr.includes.relationTypes.works_for",
        message: "Target entity type 'company' is not included",
      },
    ]);

    // The same relation inclusion attempted NOW is checked and refused.
    const late = await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/includes/relation-types`,
      payload: { key: "works_for" },
    });
    expect(late.statusCode).toBe(422);
    expect(late.json().error.message).toContain("company");
  });
});

describe("cascade protocol end-to-end", () => {
  it("deleting an included entity type without cascade is refused with sorted keys; with cascade repairs", async () => {
    const etId = await createEntityType("person", "Person");
    const zebra = await createLens("zebra_lens", "Zebra");
    const alpha = await createLens("alpha_lens", "Alpha");
    for (const lensId of [zebra, alpha]) {
      await app.inject({
        method: "POST",
        url: `/api/model/lenses/${lensId}/includes/entity-types`,
        payload: { key: "person" },
      });
    }

    const refused = await app.inject({ method: "DELETE", url: `/api/model/entity-types/${etId}` });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("CASCADE_REQUIRED");
    expect(refused.json().error.details.affectedLenses).toEqual([
      "alpha_lens",
      "zebra_lens",
    ]);

    const consented = await app.inject({
      method: "DELETE",
      url: `/api/model/entity-types/${etId}?cascade=true`,
    });
    expect(consented.statusCode).toBe(204);
    for (const lensId of [zebra, alpha]) {
      const list = await app.inject({
        method: "GET",
        url: `/api/model/lenses/${lensId}/includes/entity-types`,
      });
      expect(list.json()).toHaveLength(0);
    }
  });

  it("trigger 3 end-to-end: required-no-default property vs explicit allowlist", async () => {
    const etId = await createEntityType("person", "Person");
    await addProperty(etId, "full_name");
    const scoped = await createLens("scoped_lens", "Scoped");
    const tracking = await createLens("tracking_lens", "Tracking");
    await app.inject({
      method: "POST",
      url: `/api/model/lenses/${scoped}/includes/entity-types`,
      payload: { key: "person", properties: ["full_name"] },
    });
    // Tracking lens has no allowlist — never affected.
    await app.inject({
      method: "POST",
      url: `/api/model/lenses/${tracking}/includes/entity-types`,
      payload: { key: "person" },
    });

    const refused = await app.inject({
      method: "POST",
      url: `/api/model/entity-types/${etId}/properties`,
      payload: { key: "ssn", displayName: "SSN", dataType: "string", required: true },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("CASCADE_REQUIRED");
    expect(refused.json().error.details.affectedLenses).toEqual(["scoped_lens"]);

    const consented = await app.inject({
      method: "POST",
      url: `/api/model/entity-types/${etId}/properties?cascade=true`,
      payload: { key: "ssn", displayName: "SSN", dataType: "string", required: true },
    });
    expect(consented.statusCode).toBe(201);

    const scopedList = await app.inject({
      method: "GET",
      url: `/api/model/lenses/${scoped}/includes/entity-types`,
    });
    expect(scopedList.json()[0].properties).toEqual(["full_name", "ssn"]);
    const trackingList = await app.inject({
      method: "GET",
      url: `/api/model/lenses/${tracking}/includes/entity-types`,
    });
    expect(trackingList.json()[0].properties).toBeNull(); // untouched

    // Both lenses remain valid afterwards.
    for (const lensId of [scoped, tracking]) {
      const validation = await app.inject({
        method: "POST",
        url: `/api/model/lenses/${lensId}/validate`,
      });
      expect(validation.json().valid).toBe(true);
    }
  });

  it("property deletion never refuses: stale allowlist without cascade, cleanup with", async () => {
    const etId = await createEntityType("person", "Person");
    await addProperty(etId, "full_name");
    const nickId = await addProperty(etId, "nickname");
    const lensId = await createLens("hr", "Human Resources");
    await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/includes/entity-types`,
      payload: { key: "person", properties: ["full_name", "nickname"] },
    });

    // Without cascade: deleted anyway, the allowlist holds a stale key,
    // lens validation reports it.
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/model/entity-types/${etId}/properties/${nickId}`,
    });
    expect(deleted.statusCode).toBe(204);
    const list = await app.inject({
      method: "GET",
      url: `/api/model/lenses/${lensId}/includes/entity-types`,
    });
    expect(list.json()[0].properties).toEqual(["full_name", "nickname"]);
    const invalid = await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/validate`,
    });
    expect(invalid.json().valid).toBe(false);
    expect(invalid.json().errors[0].message).toBe(
      "Property 'nickname' does not exist on entity type 'person'",
    );

    // With cascade: the key is cleaned out of the allowlist.
    const nick2 = await addProperty(etId, "nickname");
    const updated = await app.inject({
      method: "PUT",
      url: `/api/model/lenses/${lensId}/includes/entity-types/${etId}`,
      payload: { properties: ["full_name", "nickname"] },
    });
    expect(updated.statusCode).toBe(200);
    const cleaned = await app.inject({
      method: "DELETE",
      url: `/api/model/entity-types/${etId}/properties/${nick2}?cascade=true`,
    });
    expect(cleaned.statusCode).toBe(204);
    const afterCleanup = await app.inject({
      method: "GET",
      url: `/api/model/lenses/${lensId}/includes/entity-types`,
    });
    expect(afterCleanup.json()[0].properties).toEqual(["full_name"]);
    const valid = await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/validate`,
    });
    expect(valid.json().valid).toBe(true);
  });

  it("deleting an included relation type follows the same protocol", async () => {
    await createEntityType("person", "Person");
    await createEntityType("company", "Company");
    const rtId = await createRelationType("works_for", "person", "company");
    const lensId = await createLens("hr", "Human Resources");
    await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/includes/relation-types`,
      payload: { key: "works_for" },
    });

    const refused = await app.inject({
      method: "DELETE",
      url: `/api/model/relation-types/${rtId}`,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("CASCADE_REQUIRED");
    expect(refused.json().error.details.affectedLenses).toEqual(["hr"]);

    const consented = await app.inject({
      method: "DELETE",
      url: `/api/model/relation-types/${rtId}?cascade=true`,
    });
    expect(consented.statusCode).toBe(204);
    const list = await app.inject({
      method: "GET",
      url: `/api/model/lenses/${lensId}/includes/relation-types`,
    });
    expect(list.json()).toHaveLength(0);
  });
});

describe("schema validation", () => {
  it("a clean schema with a valid scoped lens answers valid", async () => {
    const etId = await createEntityType("person", "Person");
    await addProperty(etId, "full_name", { required: true });
    const lensId = await createLens("hr", "Human Resources");
    await app.inject({
      method: "POST",
      url: `/api/model/lenses/${lensId}/includes/entity-types`,
      payload: { key: "person", properties: ["full_name"] },
    });

    const res = await app.inject({ method: "POST", url: "/api/model/schema/validate" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true, errors: [] });
  });
});
