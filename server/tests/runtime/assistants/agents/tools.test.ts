/**
 * The agent's ten tools as the model meets them, with a scripted model and
 * a mock store: the size rule and the `more` sentence of every tool that
 * can leave something out, `fields`, `offset`, `sort` and the neighbour
 * narrowing, input the schema refuses, the tool surface (names, parameter
 * descriptions, no description naming a tool the agent lacks), the
 * built-in prompt, and allowlists that name a tool agents no longer have.
 */

import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";

import { DEFAULT_AGENT_CONFIG, setAiModel, type AgentConfig } from "../../../../src/core/ai.js";
import { runAgentChat } from "../../../../src/runtime/assistants/agents/runtime.js";
import { ALL_TOOL_NAMES, buildTools, CHAT_TOOLS } from "../../../../src/runtime/assistants/agents/tools.js";
import { invalidateLoadedSchemaCache, loadSchema } from "../../../../src/runtime/schemaCache.js";
import { toolEntities } from "../../../../src/runtime/assistants/agents/entities.js";
import { EntityRefs } from "../../../../src/runtime/assistants/entities.js";
import { FORMER_AGENT_TOOLS, VALID_AGENT_TOOLS } from "../../../../src/runtime/toolNames.js";
import { newGraphThread } from "../../../assistants/threads/graphThread.js";
import { FakeToolCallingModel, toolCallMessage } from "../../aiHelpers.js";
import {
  asRuntimeStore,
  createMockRuntimeStore,
  makeEntity,
  makeFullSchema,
  makeRelation,
  makeUnscopedSchema,
  rankedEntry,
  withManagedIndices,
  type MockRuntimeStore,
} from "../../helpers.js";

type Row = Record<string, unknown>;

const TEN = [
  "list_entities",
  "get_entity",
  "get_neighbors",
  "search",
  "search_documents",
  "get_document",
  "execute_query",
  "list_saved_queries",
  "run_saved_query",
  "search_saved_queries",
];

/** The bound of one result, as JSON characters. */
const BOUND = 24_000;

const size = (value: unknown) => JSON.stringify(value).length;

let store: MockRuntimeStore;

beforeEach(() => {
  store = createMockRuntimeStore();
  store.getFullSchemaWithLensInclusions.mockResolvedValue(schemaWithDocument());
  invalidateLoadedSchemaCache();
});

afterEach(() => {
  setAiModel(null);
});

/** The unscoped fixture with a document property `bio` on person. */
function schemaWithDocument(): Row {
  const schema = makeFullSchema({ lensKey: "full_lens", lensName: "Full Lens" });
  const person = (schema.entityTypes as Row[])[0]!;
  (person.properties as Row[]).push({ key: "bio", displayName: "Bio", dataType: "document", required: false, defaultValue: null });
  return schema;
}

/** What the managed person indices read: its own fields and the `bio` document. */
const PERSON_INDEX_SCHEMA = {
  entityTypes: {
    person: {
      key: "person",
      displayName: "Person",
      nameProperty: "name",
      properties: {
        name: { key: "name", displayName: "Name", dataType: "string" },
        bio: { key: "bio", displayName: "Bio", dataType: "document" },
      },
    },
  },
  relationTypes: {},
};

/** The unscoped fixture whose company and works_for carry `count` more
 * string properties, `extra_<i>` and `rel_<i>`. */
function schemaWithManyProperties(count: number): Row {
  const schema = makeFullSchema({ lensKey: "full_lens", lensName: "Full Lens" });
  const more = (prefix: string) => Array.from({ length: count }, (_, i) => (
    { key: `${prefix}_${i}`, displayName: `${prefix} ${i}`, dataType: "string", required: false, defaultValue: null }
  ));
  const company = (schema.entityTypes as Row[]).find((type) => type.key === "company")!;
  (company.properties as Row[]).push(...more("extra"));
  const worksFor = (schema.relationTypes as Row[]).find((type) => type.key === "works_for")!;
  (worksFor.properties as Row[]).push(...more("rel"));
  return schema;
}

/** One turn in which the model calls `name` with `args` once; what the model
 * then reads as the tool's result. */
async function call(name: string, args: Row, config: AgentConfig = DEFAULT_AGENT_CONFIG): Promise<Row> {
  const fake = new FakeToolCallingModel([toolCallMessage(name, args), new AIMessage("done")]);
  setAiModel(fake);
  await runAgentChat(config, "full_lens", "go", asRuntimeStore(store), await newGraphThread());
  const message = fake.calls[1]!.find((m) => m instanceof ToolMessage);
  expect(message, `${name} was not called`).toBeDefined();
  return JSON.parse(String(message!.content)) as Row;
}

const people = (count: number, props: (i: number) => Row = () => ({})) =>
  Array.from({ length: count }, (_, i) => makeEntity({ name: `P${i}`, ...props(i) }, "person", `p${i}`));

// ---------------------------------------------------------------------------
// list_entities
// ---------------------------------------------------------------------------

describe("list_entities", () => {
  it("hands offset, sort and order to the store", async () => {
    store.listEntities.mockResolvedValue([people(2), 42]);

    const result = await call("list_entities", { entity_type_key: "person", sort: "age", order: "desc", limit: 2, offset: 40 });

    const args = store.listEntities.mock.calls[0]!;
    expect(args[5]).toBe("age");
    expect(args[6]).toBe("desc");
    expect(args[7]).toBe(2);
    expect(args[8]).toBe(40);
    expect(result).toMatchObject({ total: 42, limit: 2, offset: 40 });
    expect(result).not.toHaveProperty("more");
  });

  it("returns only the named fields, the _id, the type and the name", async () => {
    store.listEntities.mockResolvedValue([[makeEntity({ name: "Alice", age: 30, email: "a@x", active: true }, "person", "p1")], 1]);

    const result = await call("list_entities", { entity_type_key: "person", fields: ["age"] });

    expect(result.items).toEqual([{ _id: "p1", _entityTypeKey: "person", name: "Alice", age: 30 }]);
  });

  it("keeps a document property named in fields a stub", async () => {
    const bio = "Alice joined in 2019. ".repeat(10);
    store.listEntities.mockResolvedValue([[makeEntity({ name: "Alice", bio }, "person", "p1")], 1]);

    const result = await call("list_entities", { entity_type_key: "person", fields: ["bio"] });

    expect(result.items).toEqual([{ _id: "p1", _entityTypeKey: "person", name: "Alice", bio: { document: true, length: bio.length } }]);
  });

  it("refuses an unknown field, naming the type's properties", async () => {
    const result = await call("list_entities", { entity_type_key: "person", fields: ["name", "salary"] });

    expect(result.error).toContain("'salary'");
    for (const property of ["name", "age", "email", "active", "bio"]) expect(result.error).toContain(`'${property}'`);
    expect(store.listEntities).not.toHaveBeenCalled();
  });

  it("refuses a system field that does not exist", async () => {
    const result = await call("list_entities", { entity_type_key: "person", fields: ["_typo"] });

    expect(result.error).toContain("Unknown field(s) '_typo' on 'person'");
    expect(store.listEntities).not.toHaveBeenCalled();
  });

  it("refuses an argument it does not know instead of dropping it", async () => {
    const result = await call("list_entities", { entity_type_key: "person", entity_type: "person" });

    expect(result.error).toContain("Invalid arguments for list_entities");
    expect(store.listEntities).not.toHaveBeenCalled();
  });

  it("refuses an unknown sort field, naming the type's properties", async () => {
    const result = await call("list_entities", { entity_type_key: "person", sort: "salary" });

    expect(result.error).toContain("'salary'");
    for (const property of ["name", "age", "email", "active"]) expect(result.error).toContain(`'${property}'`);
    expect(store.listEntities).not.toHaveBeenCalled();
  });

  it("refuses an order outside asc and desc and a limit above 50 by their schema", async () => {
    expect((await call("list_entities", { entity_type_key: "person", order: "down" })).error)
      .toContain("Invalid arguments for list_entities");
    expect((await call("list_entities", { entity_type_key: "person", limit: 51 })).error)
      .toContain("Invalid arguments for list_entities");
    expect((await call("list_entities", { entity_type_key: "person", limit: 0 })).error)
      .toContain("Invalid arguments for list_entities");
    expect(store.listEntities).not.toHaveBeenCalled();
  });

  it("says with the exact next offset that rows remain", async () => {
    store.listEntities.mockResolvedValue([people(20), 3400]);

    const result = await call("list_entities", { entity_type_key: "person" });

    expect(result.items).toHaveLength(20);
    expect(result.more).toBe(
      "Showing rows 1-20 of 3400. If you need more, call list_entities again with the same arguments and offset: 20.",
    );
  });

  it("names the rows of a later page", async () => {
    store.listEntities.mockResolvedValue([people(20), 100]);

    const result = await call("list_entities", { entity_type_key: "person", offset: 40 });

    expect(result.more).toContain("Showing rows 41-60 of 100.");
    expect(result.more).toContain("offset: 60.");
  });

  it("carries no more when the page is the whole result", async () => {
    store.listEntities.mockResolvedValue([people(3), 3]);

    const result = await call("list_entities", { entity_type_key: "person" });

    expect(result.items).toHaveLength(3);
    expect(result).not.toHaveProperty("more");
  });

  it("cuts rows too large for one result at whole rows, more naming the first row left out", async () => {
    store.listEntities.mockResolvedValue([people(20, (i) => ({ email: `${i}`.padEnd(2000, "e") })), 20]);

    const result = await call("list_entities", { entity_type_key: "person" });

    const items = result.items as Row[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(20);
    expect(size(result)).toBeLessThanOrEqual(BOUND);
    // Whole rows: each shown row is the stored row, in order.
    items.forEach((item, i) => expect(item.email).toBe(`${i}`.padEnd(2000, "e")));
    expect(result.more).toBe(
      `Showing rows 1-${items.length} of 20. If you need more, call list_entities again with the same arguments and offset: ${items.length}.`,
    );
  });
});

// ---------------------------------------------------------------------------
// get_entity
// ---------------------------------------------------------------------------

describe("get_entity", () => {
  it("returns only the named fields, the _id, the type and the name", async () => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", age: 30, email: "a@x" }, "person", "p1"));

    const result = await call("get_entity", { entity_type_key: "person", entity_id: "p1", fields: ["email"] });

    expect(result).toEqual({ _id: "p1", _entityTypeKey: "person", name: "Alice", email: "a@x" });
  });

  it("keeps a document property named in fields a stub", async () => {
    const bio = "x".repeat(50_000);
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", bio }, "person", "p1"));

    const result = await call("get_entity", { entity_type_key: "person", entity_id: "p1", fields: ["bio"] });

    expect(result).toEqual({ _id: "p1", _entityTypeKey: "person", name: "Alice", bio: { document: true, length: 50_000 } });
  });

  it("refuses an unknown field, naming the type's properties", async () => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }, "person", "p1"));

    const result = await call("get_entity", { entity_type_key: "person", entity_id: "p1", fields: ["salary"] });

    expect(result.error).toContain("'salary'");
    for (const property of ["name", "age", "email", "active", "bio"]) expect(result.error).toContain(`'${property}'`);
  });

  it("cuts a value longer than the bound, with the marker", async () => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", email: "e".repeat(30_000) }, "person", "p1"));

    const result = await call("get_entity", { entity_type_key: "person", entity_id: "p1" });

    expect(size(result)).toBeLessThanOrEqual(BOUND);
    expect(result.name).toBe("Alice");
    expect(result.email).toMatch(/^e+…\[cut: first \d+ of 30000 characters; asking again returns the same part\]$/);
  });
});

describe("errors and the size rule", () => {
  it("bounds an error that repeats an argument of any length", async () => {
    const result = await call("get_entity", { entity_type_key: "t".repeat(30_000), entity_id: "p1" });

    expect(Object.keys(result)).toEqual(["error"]);
    expect(result.error).toMatch(/^Entity type 't+…\[cut: first \d+ of \d+ characters/);
    expect(size(result)).toBeLessThanOrEqual(BOUND);
  });

  it("bounds the failure of arguments that do not fit a tool's schema", async () => {
    const result = await call("get_entity", { entity_type_key: "person", entity_id: "p1", ["x".repeat(30_000)]: 1 });

    expect(result.error).toContain("Invalid arguments for get_entity");
    expect(size(result)).toBeLessThanOrEqual(BOUND);
  });
});

describe("get_neighbors and the size rule", () => {
  it("keeps the relation and the entity of a neighbour too large for one result, and still presents it", async () => {
    const wide = (prefix: string) => Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`${prefix}_${i}`, "v".repeat(64)]));
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schemaWithManyProperties(400));
    invalidateLoadedSchemaCache();
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }, "person", "p1"));
    store.getNeighbors.mockImplementation(async (_id: string, direction: string) => direction === "outgoing"
      ? [{
          relation: { ...makeRelation(wide("rel"), { relationId: "r1" }), direction },
          entity: makeEntity({ name: "Acme", ...wide("extra") }, "company", "c1"),
        }]
      : []);
    const events: Row[] = [];
    const fake = new FakeToolCallingModel([toolCallMessage("get_neighbors", { entity_type_key: "person", entity_id: "p1" }), new AIMessage("done")]);
    setAiModel(fake);

    await runAgentChat(DEFAULT_AGENT_CONFIG, "full_lens", "go", asRuntimeStore(store), await newGraphThread(), {
      onToolEvent: async (event) => { events.push(event); },
    });

    const result = events.find((event) => event.type === "agent.tool_result")!.result as Row;
    const [neighbour] = result.neighbors as { relation: Row; entity: Row }[];
    expect(size(result)).toBeLessThanOrEqual(BOUND);
    expect(neighbour!.relation).toMatchObject({ _id: "r1", _relationTypeKey: "works_for", direction: "outgoing" });
    expect(neighbour!.entity).toMatchObject({ _id: "c1", _entityTypeKey: "company", name: "Acme" });
    // The turn's cards were made from the bounded result.
    const cards = events.find((event) => event.type === "entities")!.entities as { id: string }[];
    expect(cards.map((card) => card.id).sort()).toEqual(["c1", "p1"]);
  });

  it("keeps a neighbour whose entity is mostly document stubs an entity, and still presents it", async () => {
    const schema = makeFullSchema({ lensKey: "full_lens", lensName: "Full Lens" });
    const company = (schema.entityTypes as Row[]).find((type) => type.key === "company")!;
    (company.properties as Row[]).push(...Array.from({ length: 1_000 }, (_, i) => (
      { key: `doc_${i}`, displayName: `Doc ${i}`, dataType: "document", required: false, defaultValue: null }
    )));
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema);
    invalidateLoadedSchemaCache();
    const documents = Object.fromEntries(Array.from({ length: 1_000 }, (_, i) => [`doc_${i}`, `text ${i}`]));
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }, "person", "p1"));
    store.getNeighbors.mockImplementation(async (_id: string, direction: string) => direction === "outgoing"
      ? [{ relation: { ...makeRelation({}, { relationId: "r1" }), direction }, entity: makeEntity({ name: "Acme", ...documents }, "company", "c1") }]
      : []);
    const events: Row[] = [];
    setAiModel(new FakeToolCallingModel([toolCallMessage("get_neighbors", { entity_type_key: "person", entity_id: "p1" }), new AIMessage("done")]));

    await runAgentChat(DEFAULT_AGENT_CONFIG, "full_lens", "go", asRuntimeStore(store), await newGraphThread(), {
      onToolEvent: async (event) => { events.push(event); },
    });

    const result = events.find((event) => event.type === "agent.tool_result")!.result as Row;
    const [neighbour] = result.neighbors as { relation: Row; entity: Row }[];
    expect(size(result)).toBeLessThanOrEqual(BOUND);
    expect(neighbour!.relation).toMatchObject({ _id: "r1", direction: "outgoing" });
    expect(neighbour!.entity).toMatchObject({ _id: "c1", _entityTypeKey: "company" });
    expect(result.more).toContain("was cut");
    const cards = events.find((event) => event.type === "entities")!.entities as { id: string }[];
    expect(cards.map((card) => card.id).sort()).toEqual(["c1", "p1"]);
  });

  it("leaves a neighbour whole when the result holds it, however large one of its values is", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schemaWithManyProperties(1));
    invalidateLoadedSchemaCache();
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }, "person", "p1"));
    store.getNeighbors.mockImplementation(async (_id: string, direction: string) => direction === "outgoing"
      ? [{ relation: { ...makeRelation({}, { relationId: "r1" }), direction }, entity: makeEntity({ name: "Acme", extra_0: "i".repeat(15_000) }, "company", "c1") }]
      : []);

    const result = await call("get_neighbors", { entity_type_key: "person", entity_id: "p1" });

    const [neighbour] = result.neighbors as { entity: Row }[];
    expect(size(result)).toBeLessThanOrEqual(BOUND);
    expect(neighbour!.entity.extra_0).toBe("i".repeat(15_000));
    expect(result).not.toHaveProperty("more");
  });

  it("keeps a neighbour's relation and entity at every size around the room a result has", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schemaWithManyProperties(1));
    invalidateLoadedSchemaCache();
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }, "person", "p1"));
    const neighbourOf = (length: number) => ({
      relation: { ...makeRelation({}, { relationId: "r1" }), direction: "outgoing" },
      entity: makeEntity({ name: "Acme", extra_0: "i".repeat(length) }, "company", "c1"),
    });
    // Every length around the one where the neighbour stops fitting whole, and a few far from it.
    const atBound = BOUND - size(neighbourOf(0));
    const whole: number[] = [];
    const lengths = [atBound - 5_000, ...Array.from({ length: 140 }, (_, i) => atBound - 990 + i), atBound, atBound + 5_000];
    for (const length of lengths) {
      store.getNeighbors.mockImplementation(async (_id: string, direction: string) => (direction === "outgoing" ? [neighbourOf(length)] : []));

      const result = await call("get_neighbors", { entity_type_key: "person", entity_id: "p1" });

      const [neighbour] = result.neighbors as { relation: Row; entity: Row }[];
      expect(size(result), `length ${length}`).toBeLessThanOrEqual(BOUND);
      expect(neighbour!.relation, `length ${length}`).toMatchObject({ _id: "r1", direction: "outgoing" });
      expect(neighbour!.entity, `length ${length}`).toMatchObject({ _id: "c1", _entityTypeKey: "company", name: "Acme" });
      // Whole, or shortened and said so: never one without the other.
      const kept = neighbour!.entity.extra_0 === "i".repeat(length);
      expect("more" in result, `length ${length}`).toBe(!kept);
      if (kept) whole.push(length);
      else expect(result.more).toBe("A long value of a neighbour was cut to fit this result.");
    }
    // The sweep crossed the boundary: some lengths fitted whole, the larger ones did not.
    expect(whole.length).toBeGreaterThan(1);
    expect(whole.length).toBeLessThan(lengths.length - 2);
    expect(Math.max(...whole)).toBeLessThan(atBound);
  }, 30_000);

  it("says of a neighbour's value cut to fit that reading the neighbour itself returns more", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schemaWithManyProperties(1));
    invalidateLoadedSchemaCache();
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }, "person", "p1"));
    store.getNeighbors.mockImplementation(async (_id: string, direction: string) => direction === "outgoing"
      ? [{ relation: { ...makeRelation({}, { relationId: "r1" }), direction }, entity: makeEntity({ name: "Acme", extra_0: "i".repeat(40_000) }, "company", "c1") }]
      : []);

    const result = await call("get_neighbors", { entity_type_key: "person", entity_id: "p1" });

    const [neighbour] = result.neighbors as { relation: Row; entity: Row }[];
    expect(size(result)).toBeLessThanOrEqual(BOUND);
    expect(neighbour!.relation).toMatchObject({ _id: "r1", direction: "outgoing" });
    expect(neighbour!.entity.extra_0).toMatch(/^i+…\[cut: first \d+ of 40000 characters/);
    // The neighbour has nearly the whole result, not a fixed half of it.
    expect(size(neighbour!.entity)).toBeGreaterThan(BOUND * 0.8);
    expect(result.more).toBe("A long value of a neighbour was cut to fit this result.");
  });

  it("keeps the name of an entity that loses values, wherever the name stands among them", async () => {
    const wide = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`extra_${i}`, "v".repeat(64)]));
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schemaWithManyProperties(600));
    invalidateLoadedSchemaCache();
    // The name comes last, as a store may hand it.
    const acme = { ...makeEntity(wide, "company", "c1"), name: "Acme" };
    store.getEntity.mockResolvedValue(structuredClone(acme));
    store.listEntities.mockResolvedValue([[structuredClone(acme)], 1]);
    store.getNeighbors.mockImplementation(async (_id: string, direction: string) => direction === "incoming"
      ? [{ relation: { ...makeRelation({}, { relationId: "r1" }), direction }, entity: makeEntity({ name: "Alice" }, "person", "p1") }]
      : []);

    const read = await call("get_entity", { entity_type_key: "company", entity_id: "c1" });
    expect(size(read)).toBeLessThanOrEqual(BOUND);
    expect(read["…"]).toMatch(/^\[cut: first \d+ of \d+ values\]$/);
    expect(read).toMatchObject({ _id: "c1", _entityTypeKey: "company", name: "Acme" });

    const listed = await call("list_entities", { entity_type_key: "company" });
    expect((listed.items as Row[])[0]).toMatchObject({ _id: "c1", name: "Acme" });

    const around = await call("get_neighbors", { entity_type_key: "company", entity_id: "c1" });
    expect(size(around)).toBeLessThanOrEqual(BOUND);
    expect(around.entity).toMatchObject({ _id: "c1", name: "Acme" });
  });

  it("says nothing of a cut made only to a neighbour the result leaves out", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schemaWithManyProperties(1));
    invalidateLoadedSchemaCache();
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }, "person", "p1"));
    const neighbour = (id: string, length: number) => ({
      relation: { ...makeRelation({}, { relationId: `r-${id}` }), direction: "outgoing" },
      entity: makeEntity({ name: id, extra_0: "i".repeat(length) }, "company", id),
    });
    store.getNeighbors.mockImplementation(async (_id: string, direction: string) => direction === "outgoing"
      ? [neighbour("c1", 10_000), neighbour("c2", 10_000), neighbour("c3", 40_000)]
      : []);

    const result = await call("get_neighbors", { entity_type_key: "person", entity_id: "p1" });

    const shown = result.neighbors as { entity: Row }[];
    expect(shown.map((one) => one.entity._id)).toEqual(["c1", "c2"]);
    expect(shown[0]!.entity.extra_0).toBe("i".repeat(10_000));
    expect(result.more).toContain("Only the first 2 of the 3 neighbours read fit this result.");
    expect(result.more).not.toContain("was cut");
  });

  it("keeps an entity an entity, with the name of its own type, when many types of the lens name theirs differently", async () => {
    // 400 more entity types, each named by a property of its own; a company carries all those properties too.
    const schema = makeFullSchema({ lensKey: "full_lens", lensName: "Full Lens" });
    const titles = Array.from({ length: 400 }, (_, i) => `title_${i}`);
    const property = (key: string) => ({ key, displayName: key, dataType: "string", required: false, defaultValue: null });
    (schema.entityTypes as Row[]).push(...titles.map((title, i) => ({
      entityTypeId: `et-x${i}`, key: `kind_${i}`, displayName: `Kind ${i}`, description: null, nameProperty: title, properties: [property(title)],
    })));
    const company = (schema.entityTypes as Row[]).find((type) => type.key === "company")!;
    (company.properties as Row[]).push(...titles.map(property));
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema);
    invalidateLoadedSchemaCache();
    const acme = makeEntity({ ...Object.fromEntries(titles.map((title) => [title, "t".repeat(64)])), name: "Acme" }, "company", "c1");
    store.getEntity.mockResolvedValue(structuredClone(acme));
    store.listEntities.mockResolvedValue([[structuredClone(acme)], 1]);
    store.executeOql.mockResolvedValue([titles, [Object.fromEntries(titles.map((title) => [title, "t".repeat(64)]))]]);

    const read = await call("get_entity", { entity_type_key: "company", entity_id: "c1" });
    expect(size(read)).toBeLessThanOrEqual(BOUND);
    expect(read).toMatchObject({ _id: "c1", _entityTypeKey: "company", name: "Acme" });

    const listed = await call("list_entities", { entity_type_key: "company" });
    expect((listed.items as Row[])[0]).toMatchObject({ _id: "c1", _entityTypeKey: "company", name: "Acme" });

    // A query row is no entity: its columns are ordinary values, and the row stays an object.
    const queried = await call("execute_query", { query: QUERY });
    const [row] = queried.results as Row[];
    expect(size(queried)).toBeLessThanOrEqual(BOUND);
    expect(typeof row).toBe("object");
    expect(row!.title_0).toBe("t".repeat(64));
  });

  it("says of an entity without neighbours only that its value was cut", async () => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", email: "e".repeat(100_000) }, "person", "p1"));
    store.getNeighbors.mockResolvedValue([]);

    const result = await call("get_neighbors", { entity_type_key: "person", entity_id: "p1" });

    expect(size(result)).toBeLessThanOrEqual(BOUND);
    expect(result.more).toContain("Asking again returns the same part");
    expect(result.more).not.toContain("get_entity");
  });


  it("leaves an entity without neighbours the whole result", async () => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", email: "e".repeat(15_000) }, "person", "p1"));
    store.getNeighbors.mockResolvedValue([]);

    const result = await call("get_neighbors", { entity_type_key: "person", entity_id: "p1" });

    expect((result.entity as Row).email).toBe("e".repeat(15_000));
    expect(result).not.toHaveProperty("more");
  });

  it("cuts a long value of the entity to leave room for its neighbours, and says where more of it is", async () => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", email: "e".repeat(15_000) }, "person", "p1"));
    store.getNeighbors.mockImplementation(async (_id: string, direction: string) => direction === "outgoing"
      ? [{ relation: { ...makeRelation({}, { relationId: "r1" }), direction }, entity: makeEntity({ name: "Acme" }, "company", "c1") }]
      : []);

    const result = await call("get_neighbors", { entity_type_key: "person", entity_id: "p1" });

    expect(size(result)).toBeLessThanOrEqual(BOUND);
    expect((result.entity as Row).email).toMatch(/…\[cut: first \d+ of 15000 characters/);
    expect(result.neighbors).toHaveLength(1);
    expect(result.more).toBe("A long value of the entity was cut to leave room for its neighbours. get_entity returns more of it.");
  });
});

// ---------------------------------------------------------------------------
// get_document
// ---------------------------------------------------------------------------

describe("get_document", () => {
  const TEXT = "0123456789".repeat(3_000);

  beforeEach(() => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", bio: TEXT }, "person", "p1"));
  });

  it("without a range reads the first piece, more naming the next offset", async () => {
    const result = await call("get_document", { entity_type_key: "person", entity_id: "p1", property_key: "bio" });

    expect(result.content).toBe(TEXT.slice(0, 20_000));
    expect(result).toMatchObject({ offset: 0, length: 20_000, totalLength: 30_000 });
    expect(result.more).toBe(
      "Showing characters 0-20000 of 30000. To read on, call get_document again with offset: 20000.",
    );
  });

  it("ends a piece earlier when its text takes more room written out, and names the offset it really reached", async () => {
    const escaped = '\\"\n'.repeat(10_000);
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", bio: escaped }, "person", "p1"));

    const result = await call("get_document", { entity_type_key: "person", entity_id: "p1", property_key: "bio" });

    const content = result.content as string;
    expect(size(result)).toBeLessThanOrEqual(BOUND);
    expect(content.length).toBeLessThan(20_000);
    expect(escaped.startsWith(content)).toBe(true);
    expect(result).toMatchObject({ offset: 0, length: content.length, totalLength: 30_000 });
    expect(result.more).toBe(
      `Showing characters 0-${content.length} of 30000. To read on, call get_document again with offset: ${content.length}.`,
    );
  });

  it("from an offset without a limit reads the rest when it fits, without more", async () => {
    const result = await call("get_document", { entity_type_key: "person", entity_id: "p1", property_key: "bio", offset: 20_000 });

    expect(result).toMatchObject({ offset: 20_000, length: 10_000, totalLength: 30_000 });
    expect(result).not.toHaveProperty("more");
  });

  it("reads a range the model chose, and still says where the text goes on", async () => {
    const result = await call("get_document", { entity_type_key: "person", entity_id: "p1", property_key: "bio", offset: 10, limit: 5 });

    expect(result).toEqual({
      propertyKey: "bio", content: "01234", offset: 10, length: 5, totalLength: 30_000,
      more: "Showing characters 10-15 of 30000. To read on, call get_document again with offset: 15.",
    });
  });

  it("counts a piece of characters outside the basic plane in characters, as the document does", async () => {
    const astral = "😀\n".repeat(15_000);
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", bio: astral }, "person", "p1"));

    const result = await call("get_document", { entity_type_key: "person", entity_id: "p1", property_key: "bio" });

    const shown = Array.from(result.content as string).length;
    expect(size(result)).toBeLessThanOrEqual(BOUND);
    expect(astral.startsWith(result.content as string)).toBe(true);
    expect(result).toMatchObject({ offset: 0, length: shown, totalLength: 30_000 });
    expect(result.more).toContain(`call get_document again with offset: ${shown}.`);
  });

  it("carries no more for a range that ends with the text", async () => {
    const result = await call("get_document", { entity_type_key: "person", entity_id: "p1", property_key: "bio", offset: 29_990, limit: 10 });

    expect(result).toEqual({ propertyKey: "bio", content: "0123456789", offset: 29_990, length: 10, totalLength: 30_000 });
  });

  it("refuses a limit above 20000 by its schema", async () => {
    const result = await call("get_document", { entity_type_key: "person", entity_id: "p1", property_key: "bio", limit: 20_001 });

    expect(result.error).toContain("Invalid arguments for get_document");
    expect(store.getEntity).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// get_neighbors
// ---------------------------------------------------------------------------

describe("get_neighbors", () => {
  const neighbour = (id: string, direction: string, entity: Row = makeEntity({ name: id }, "company", id)) => ({
    relation: { ...makeRelation({}, { relationId: `r-${id}` }), direction },
    entity,
  });

  /** Neighbours by direction, as the store reads them, at most `limit`. */
  function storeNeighbours(byDirection: Record<string, Row[]>): void {
    store.getNeighbors.mockImplementation(async (_id: string, direction: string, _types: unknown, limit: number) =>
      (byDirection[direction] ?? []).slice(0, limit).map((row) => structuredClone(row)));
  }

  beforeEach(() => {
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", age: 30, email: "a@x" }, "person", "p1"));
  });

  it("hands relation_type_key to the store", async () => {
    await call("get_neighbors", { entity_type_key: "person", entity_id: "p1", direction: "outgoing", relation_type_key: "works_for" });

    expect(store.getNeighbors).toHaveBeenCalledTimes(1);
    const [id, direction, types] = store.getNeighbors.mock.calls[0]!;
    expect([id, direction, types]).toEqual(["p1", "outgoing", ["works_for"]]);
  });

  it("refuses an unknown relation type, naming the lens's relation types", async () => {
    const result = await call("get_neighbors", { entity_type_key: "person", entity_id: "p1", relation_type_key: "knows" });

    expect(result.error).toContain("'knows'");
    expect(result.error).toContain("'works_for'");
    expect(result.error).toContain("'belongs_to'");
    expect(store.getNeighbors).not.toHaveBeenCalled();
  });

  it("refuses a direction outside outgoing, incoming and both by its schema", async () => {
    const result = await call("get_neighbors", { entity_type_key: "person", entity_id: "p1", direction: "sideways" });

    expect(result.error).toContain("Invalid arguments for get_neighbors");
    expect(store.getNeighbors).not.toHaveBeenCalled();
  });

  it("reads both directions separately, each with its own limit", async () => {
    storeNeighbours({
      outgoing: [neighbour("c1", "outgoing"), neighbour("c2", "outgoing"), neighbour("c3", "outgoing")],
      incoming: [neighbour("c4", "incoming")],
    });

    const result = await call("get_neighbors", { entity_type_key: "person", entity_id: "p1", limit: 2 });

    expect(store.getNeighbors.mock.calls.map((args) => args[1])).toEqual(["outgoing", "incoming"]);
    // One beyond the limit, so a longer side is known.
    for (const args of store.getNeighbors.mock.calls) expect(args[3]).toBe(3);
    expect((result.neighbors as Row[]).map((n) => (n.entity as Row)._id)).toEqual(["c1", "c2", "c4"]);
  });

  it("says which direction has more neighbours than shown", async () => {
    storeNeighbours({
      outgoing: [neighbour("c1", "outgoing"), neighbour("c2", "outgoing"), neighbour("c3", "outgoing")],
      incoming: [neighbour("c4", "incoming")],
    });

    const result = await call("get_neighbors", { entity_type_key: "person", entity_id: "p1", limit: 2 });

    expect(result.more).toContain("More outgoing neighbours exist than the 2 read.");
    expect(result.more).not.toContain("incoming");
  });

  it("carries no more when every neighbour is shown", async () => {
    storeNeighbours({ outgoing: [neighbour("c1", "outgoing")], incoming: [neighbour("c4", "incoming")] });

    const result = await call("get_neighbors", { entity_type_key: "person", entity_id: "p1" });

    expect(result.neighbors).toHaveLength(2);
    expect(result).not.toHaveProperty("more");
  });

  it("applies fields to the entity and its neighbours alike", async () => {
    storeNeighbours({
      incoming: [neighbour("p2", "incoming", makeEntity({ name: "Bob", age: 40, email: "b@x" }, "person", "p2"))],
    });

    const result = await call("get_neighbors", { entity_type_key: "person", entity_id: "p1", direction: "incoming", fields: ["email"] });

    expect(result.entity).toEqual({ _id: "p1", _entityTypeKey: "person", name: "Alice", email: "a@x" });
    expect((result.neighbors as Row[])[0]!.entity).toEqual({ _id: "p2", _entityTypeKey: "person", name: "Bob", email: "b@x" });
  });
});

// ---------------------------------------------------------------------------
// execute_query and run_saved_query
// ---------------------------------------------------------------------------

const QUERY = "MATCH (p:person) RETURN p.name";
const rowsOf = (count: number, width = 10) =>
  Array.from({ length: count }, (_, i) => ({ "p.name": `${i}`.padEnd(width, "n") }));

describe("execute_query", () => {
  it("hands a rejected query back with the hints that name what would be valid", async () => {
    const result = await call("execute_query", { query: "MATCH (p:persn) RETURN p.name" });

    expect(Object.keys(result)).toEqual(["error"]);
    expect(result.error).toContain("Query validation failed: ");
    expect(result.error).toContain("persn");
    expect(result.error).toContain("person");
    expect(result.error).toContain("company");
  });

  it("starts at offset", async () => {
    store.executeOql.mockResolvedValue([["p.name"], rowsOf(30)]);

    const result = await call("execute_query", { query: QUERY, offset: 10 });

    expect(result.results).toEqual(rowsOf(30).slice(10));
    expect(result).not.toHaveProperty("more");
  });

  it("cuts rows by the size rule, more naming the next offset and the missing ORDER BY", async () => {
    store.executeOql.mockResolvedValue([["p.name"], rowsOf(100, 500)]);

    const result = await call("execute_query", { query: QUERY });

    const rows = result.results as Row[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    expect(size(rows)).toBeLessThanOrEqual(BOUND);
    expect(rows).toEqual(rowsOf(100, 500).slice(0, rows.length));
    expect(result.more).toContain(
      `Showing rows 1-${rows.length} of 100. If you need more, call execute_query again with the same query and offset: ${rows.length}.`,
    );
    expect(result.more).toContain("Without ORDER BY the order of rows can change between calls.");
    expect(size(result)).toBeLessThanOrEqual(BOUND);
  });

  it("reads the ORDER BY from the query, not from a text inside it", async () => {
    store.executeOql.mockResolvedValue([["p.name"], rowsOf(100, 500)]);

    const result = await call("execute_query", { query: "MATCH (p:person) WHERE p.name CONTAINS 'ORDER BY' RETURN p.name" });

    expect(result.more).toContain("Without ORDER BY the order of rows can change between calls.");
  });

  it("refuses a result whose column names alone would fill it, instead of parting them from their rows", async () => {
    const column = "c".repeat(13_000);
    store.executeOql.mockResolvedValue([[column], [{ [column]: "Alice" }]]);

    const result = await call("execute_query", { query: QUERY });

    expect(Object.keys(result)).toEqual(["error"]);
    expect(result.error).toContain("Give the columns short names with AS.");
    expect(size(result)).toBeLessThanOrEqual(BOUND);
  });

  it("counts only an ORDER BY of the RETURN as ordering the rows", async () => {
    store.executeOql.mockResolvedValue([["p.name", "n"], rowsOf(100, 500)]);

    const result = await call("execute_query", {
      query: "MATCH (p:person) WITH p ORDER BY p.name RETURN p.name, count(*) AS n",
    });

    expect(result.more).toContain("Without ORDER BY the order of rows can change between calls.");
  });

  it("takes null for an argument left out", async () => {
    store.executeOql.mockResolvedValue([["p.name"], rowsOf(3)]);

    const result = await call("execute_query", { query: QUERY, offset: null });

    expect(result.results).toEqual(rowsOf(3));
  });

  it("refuses an argument it does not know instead of dropping it", async () => {
    const result = await call("execute_query", { query: QUERY, limit: 5 });

    expect(result.error).toContain("Invalid arguments for execute_query");
    expect(store.executeOql).not.toHaveBeenCalled();
  });

  it("gives no ORDER BY hint when the query has one", async () => {
    store.executeOql.mockResolvedValue([["p.name"], rowsOf(100, 500)]);

    const result = await call("execute_query", { query: `${QUERY} ORDER BY p.name` });

    expect(result.more).toContain("Showing rows 1-");
    expect(result.more).not.toContain("ORDER BY");
  });

  it("cuts an oversized single cell with the marker", async () => {
    store.executeOql.mockResolvedValue([["p.name"], [{ "p.name": "n".repeat(30_000) }]]);

    const result = await call("execute_query", { query: QUERY });

    const rows = result.results as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!["p.name"]).toMatch(/…\[cut: first \d+ of 30000 characters; asking again returns the same part\]$/);
    expect(size(result)).toBeLessThanOrEqual(BOUND + 500);
    expect(result.more).toContain("was cut");
  });

  it("says when the offset is past the end", async () => {
    store.executeOql.mockResolvedValue([["p.name"], rowsOf(5)]);

    const result = await call("execute_query", { query: QUERY, offset: 10 });

    expect(result.results).toEqual([]);
    expect(result.more).toBe("No rows from offset 10: there are 5 rows.");
  });
});

describe("run_saved_query", () => {
  beforeEach(() => {
    store.getSavedQueries.mockResolvedValue([{
      key: "everyone", name: "Everyone", description: "Every person",
      steps: JSON.stringify([{ name: "main", type: "oql", oql: QUERY }]),
      parameters: "[]",
    }]);
  });

  it("starts at offset", async () => {
    store.executeOql.mockResolvedValue([["p.name"], rowsOf(30)]);

    const result = await call("run_saved_query", { query_key: "everyone", offset: 25 });

    expect(result.results).toEqual(rowsOf(30).slice(25));
    expect(result).not.toHaveProperty("more");
  });

  it("cuts rows by the size rule, more naming the next offset", async () => {
    store.executeOql.mockResolvedValue([["p.name"], rowsOf(100, 500)]);

    const result = await call("run_saved_query", { query_key: "everyone" });

    const rows = result.results as Row[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    expect(size(rows)).toBeLessThanOrEqual(BOUND);
    expect(size(result)).toBeLessThanOrEqual(BOUND);
    expect(result.more).toBe(
      `Showing rows 1-${rows.length} of 100. If you need more, call run_saved_query again with the same arguments and offset: ${rows.length}. ` +
        "Without ORDER BY the order of rows can change between calls.",
    );
  });

  it("gives no ORDER BY hint when the saved query's last step orders its rows", async () => {
    store.getSavedQueries.mockResolvedValue([{
      key: "everyone", name: "Everyone", description: "Every person",
      steps: JSON.stringify([{ name: "main", type: "oql", oql: `${QUERY} ORDER BY p.name` }]),
      parameters: "[]",
    }]);
    invalidateLoadedSchemaCache();
    store.executeOql.mockResolvedValue([["p.name"], rowsOf(100, 500)]);

    const result = await call("run_saved_query", { query_key: "everyone" });

    expect(result.more).toMatch(/^Showing rows 1-\d+ of 100\. If you need more, call run_saved_query again with the same arguments and offset: \d+\.$/);
  });

  it("cuts an oversized single cell with the marker", async () => {
    store.executeOql.mockResolvedValue([["p.name"], [{ "p.name": "n".repeat(30_000) }]]);

    const result = await call("run_saved_query", { query_key: "everyone" });

    expect((result.results as Row[])[0]!["p.name"]).toMatch(/…\[cut: first \d+ of 30000 characters; asking again returns the same part\]$/);
    expect(result.more).toContain("was cut");
  });

  it("says when the offset is past the end", async () => {
    store.executeOql.mockResolvedValue([["p.name"], rowsOf(5)]);

    const result = await call("run_saved_query", { query_key: "everyone", offset: 7 });

    expect(result.results).toEqual([]);
    expect(result.more).toBe("No rows from offset 7: there are 5 rows.");
  });
});

// ---------------------------------------------------------------------------
// search and search_documents
// ---------------------------------------------------------------------------

describe("search tools", () => {
  beforeEach(() => {
    store.supportsKeywordRanking.mockReturnValue(true);
  });

  it("search leaves out the items that do not fit, and says so", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
    withManagedIndices(store, PERSON_INDEX_SCHEMA, undefined, (query) =>
      query.generationId === "person~default/keyword" ? ids.map((id, i) => rankedEntry(id, 1 - i / 100)) : []);
    store.getEntitiesByIds.mockImplementation(async (wanted: string[]) =>
      Object.fromEntries(wanted.map((id) => [id, makeEntity({ name: id.padEnd(2_000, "x") }, "person", id)])));

    const result = await call("search", { query: "engineer", limit: 20 });

    const items = result.items as Row[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(20);
    expect(size(items)).toBeLessThanOrEqual(BOUND);
    expect(result.more).toBe(
      `Only the first ${items.length} of 20 found entities fit this result. Narrow with types or filters, or ask for fewer with limit.`,
    );
  });

  it("search carries no more when every item fits", async () => {
    withManagedIndices(store, PERSON_INDEX_SCHEMA, undefined, (query) =>
      query.generationId === "person~default/keyword" ? [rankedEntry("p1", 0.9)] : []);
    store.getEntitiesByIds.mockResolvedValue({ p1: makeEntity({ name: "Alice" }, "person", "p1") });

    const result = await call("search", { query: "engineer" });

    expect(result.items).toHaveLength(1);
    expect(result).not.toHaveProperty("more");
  });

  it("search_documents leaves out the passages that do not fit and suggests text: false", async () => {
    withManagedIndices(store, PERSON_INDEX_SCHEMA, undefined, (query) =>
      query.generationId === "person~bio/keyword"
        ? Array.from({ length: 10 }, (_, i) =>
          rankedEntry(`p${i}`, 1 - i / 100, { startChar: 0, charLength: 5_000, text: "t".repeat(5_000) }))
        : []);
    store.getEntitiesByIds.mockImplementation(async (wanted: string[]) =>
      Object.fromEntries(wanted.map((id) => [id, makeEntity({ name: id, bio: "t".repeat(5_000) }, "person", id)])));

    const result = await call("search_documents", { query: "joined", limit: 10 });

    const items = result.items as Row[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(10);
    expect(size(items)).toBeLessThanOrEqual(BOUND);
    expect(result.more).toBe(
      `Only the first ${items.length} of 10 found passages fit this result. Call again with text: false to get every passage without its text.`,
    );
  });
});

// ---------------------------------------------------------------------------
// The tool surface
// ---------------------------------------------------------------------------

describe("tool surface", () => {
  const all = () => buildTools("full_lens", asRuntimeStore(store), [...ALL_TOOL_NAMES]);

  it("has exactly the ten tools", () => {
    expect([...CHAT_TOOLS].sort()).toEqual([...TEN].sort());
    expect([...ALL_TOOL_NAMES].sort()).toEqual([...TEN].sort());
    expect([...VALID_AGENT_TOOLS].sort()).toEqual([...TEN].sort());
    for (const former of ["get_schema", "list_relations"]) {
      expect(ALL_TOOL_NAMES.has(former)).toBe(false);
      expect(FORMER_AGENT_TOOLS.has(former)).toBe(true);
    }
  });

  it("no description names a tool the agent was not granted", () => {
    // "search" is also a plain word ("a search step"); the other nine are not.
    for (const left of TEN.filter((name) => name !== "search")) {
      const granted = TEN.filter((name) => name !== left);
      for (const tool of buildTools("full_lens", asRuntimeStore(store), granted)) {
        expect(tool.description, `${tool.name} without ${left}`).not.toMatch(new RegExp(`\\b${left}\\b`));
        expect(tool.description.length).toBeLessThanOrEqual(2_000);
      }
    }
  });

  it("a description names get_document when the agent has it", () => {
    const descriptions = new Map(all().map((tool) => [tool.name, tool.description]));
    for (const name of ["get_entity", "execute_query", "search_documents", "list_entities"]) {
      expect(descriptions.get(name), name).toMatch(/\bget_document\b/);
    }
    expect(descriptions.get("run_saved_query")).toMatch(/\blist_saved_queries\b/);
  });

  it("every parameter of every tool has a description", () => {
    for (const tool of all()) {
      const shape = (tool.input as z.ZodObject).shape as Record<string, z.ZodType>;
      for (const [key, field] of Object.entries(shape)) {
        expect(field.description, `${tool.name}.${key}`).toBeTruthy();
      }
    }
  });

  it("every description is at most 2000 characters", () => {
    for (const tool of all()) expect(tool.description.length, tool.name).toBeLessThanOrEqual(2_000);
  });
});

// ---------------------------------------------------------------------------
// The built-in prompt
// ---------------------------------------------------------------------------

describe("built-in prompt", () => {
  it("names none of the tools", async () => {
    const fake = new FakeToolCallingModel([new AIMessage("hi")]);
    setAiModel(fake);
    await runAgentChat(DEFAULT_AGENT_CONFIG, "full_lens", "hello", asRuntimeStore(store), await newGraphThread());

    const system = String(fake.calls[0]![0]!.content);
    const prompt = system.slice(0, system.indexOf("<context"));
    expect(prompt).toContain("You are a knowledge graph assistant.");
    for (const name of [...TEN, ...FORMER_AGENT_TOOLS]) expect(prompt).not.toMatch(new RegExp(`\\b${name}\\b`));
  });
});

// ---------------------------------------------------------------------------
// Allowlists that name a tool agents no longer have
// ---------------------------------------------------------------------------

describe("stored allowlists", () => {
  beforeEach(() => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(makeUnscopedSchema());
    store.getAgentConfigs.mockResolvedValue([{
      key: "old", name: "Old", description: null, systemPrompt: null,
      tools: ["get_schema", "execute_query", "list_relations", "get_entity"],
    }]);
    invalidateLoadedSchemaCache();
  });

  it("are read without the tools agents no longer have", async () => {
    const loaded = await loadSchema("full_lens", asRuntimeStore(store));

    expect(loaded.agentConfigs.old!.tools).toEqual(["execute_query", "get_entity"]);
  });

  it("give the agent the tools that remain", async () => {
    const loaded = await loadSchema("full_lens", asRuntimeStore(store));
    const fake = new FakeToolCallingModel([new AIMessage("hi")]);
    setAiModel(fake);

    await runAgentChat(loaded.agentConfigs.old!, "full_lens", "hello", asRuntimeStore(store), await newGraphThread());

    expect((fake.boundTools[0] ?? []).map((tool) => (tool as { name: string }).name)).toEqual(["execute_query", "get_entity"]);
  });
});

describe("entity cards", () => {
  it("are read off the parts of a result that are entities, and skip any other part", async () => {
    const lens = (await loadSchema("full_lens", asRuntimeStore(store))).scoped;
    const acme = makeEntity({ name: "Acme" }, "company", "c1");
    const relation = { ...makeRelation({}, { relationId: "r1" }), direction: "outgoing" };

    const neighbours = toolEntities("get_neighbors", { entity_type_key: "person" }, {
      entity: makeEntity({ name: "Alice" }, "person", "p1"),
      neighbors: ["…[cut]", { relation }, { relation, entity: "…[cut]" }, { relation, entity: acme }],
    }, lens, new EntityRefs());
    expect(neighbours.entities.map((card) => card.id)).toEqual(["p1", "c1"]);
    expect(neighbours.links).toHaveLength(1);

    const found = toolEntities("search", {}, {
      items: ["…[cut]", { rank: 1 }, { rank: 2, entity: { _id: "c1", _entityTypeKey: "company", name: "Acme" } }],
    }, lens, new EntityRefs());
    expect(found.entities.map((card) => card.id)).toEqual(["c1"]);
  });
});
