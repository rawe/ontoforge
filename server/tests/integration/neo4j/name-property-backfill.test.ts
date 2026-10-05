/**
 * Neo4j boot backfill of name properties — reaches past the persistence
 * port on purpose: entity types stored before name properties existed are
 * seeded with raw Cypher, and the next adapter boot must give each one its
 * name property by the legacy fallback. Requires the docker-compose Neo4j.
 */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDriver } from "../../../src/adapters/neo4j/driver.js";
import { runSession } from "../../../src/adapters/neo4j/errors.js";
import { settings } from "../../../src/config.js";
import {
  closeStores,
  getModelingStore,
  getOntologyRegistry,
  initStores,
} from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";

/** Entity types as 5.x stored them: no `nameProperty`, properties in
 * declaration (creation) order. */
async function seedLegacyTypes(types: Record<string, [key: string, dataType: string][]>) {
  await runSession(getDriver(), async (session) => {
    let tick = 0;
    for (const [typeKey, properties] of Object.entries(types)) {
      await session.run(
        `CREATE (:EntityType {entityTypeId: $id, key: $key, displayName: $key,
                              createdAt: datetime(), updatedAt: datetime()})`,
        { id: randomUUID(), key: typeKey },
      );
      for (const [key, dataType] of properties) {
        tick += 1;
        await session.run(
          `MATCH (et:EntityType {key: $typeKey})
           CREATE (et)-[:HAS_PROPERTY]->(:PropertyDefinition {
             propertyId: $id, key: $key, displayName: $key, dataType: $dataType,
             required: true, createdAt: datetime() + duration({seconds: $tick}),
             updatedAt: datetime()})`,
          { typeKey, id: randomUUID(), key, dataType, tick },
        );
      }
    }
  });
}

describe.skipIf(settings.DB_BACKEND !== "neo4j")("Neo4j name-property backfill at boot", () => {
  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
  });

  afterAll(async () => {
    await wipeDatabase();
    await closeStores();
  });

  it("gives every stored entity type a name property, once", async () => {
    await getOntologyRegistry().createOntology(randomUUID(), "legacy", null, null, "english");
    await seedLegacyTypes({
      article: [["summary", "string"], ["label", "string"], ["title", "string"]],
      empty: [],
      note: [["body", "document"], ["summary", "string"]],
      reading: [["name", "integer"]],
    });

    await closeStores();
    await initStores();

    const store = await getModelingStore("legacy");
    const types = await store.listEntityTypes();
    expect(types.map((et) => [et.key, et.nameProperty])).toEqual([
      ["article", "title"],
      ["empty", "name"],
      ["note", "summary"],
      ["reading", "name_2"],
    ]);
    const reading = types.find((et) => et.key === "reading")!;
    const created = await store.getPropertyByKey(reading.entityTypeId as string, "EntityType", "name_2");
    expect(created).toMatchObject({ dataType: "string", required: false, displayName: "name_2" });

    // A second boot finds nothing left to do.
    await closeStores();
    await initStores();
    const again = await (await getModelingStore("legacy")).listEntityTypes();
    expect(again.map((et) => et.nameProperty)).toEqual(["title", "name", "summary", "name_2"]);
    const empty = again.find((et) => et.key === "empty")!;
    expect(
      await (await getModelingStore("legacy")).listProperties(empty.entityTypeId as string, "EntityType"),
    ).toHaveLength(1);
  });
});
