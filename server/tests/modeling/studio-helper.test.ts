/**
 * The Studio helper's prepared run, without a store or a model: fixed
 * instructions, every description only in a labelled context block, the
 * focus as a block of its own, and exactly the design tools and the
 * proposal tool and the draft tool.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { describe, expect, it } from "vitest";

import type { ModelingStore } from "../../src/core/ports.js";
import { addressLines, DesignAddress } from "../../src/modeling/helper/address.js";
import { INSTRUCTIONS, studioRun } from "../../src/modeling/helper/helper.js";

const property = (key: string, description: string | null) =>
  ({ key, displayName: key, description, dataType: "string", required: false, defaultValue: null });

/** A design as the transfer export has it; every description is marked. */
const DESIGN = {
  entityTypes: [
    { key: "person", displayName: "Person", description: "D-person", nameProperty: "name", properties: [property("name", "D-name")] },
    { key: "company", displayName: "Company", description: null, nameProperty: "name", properties: [] },
  ],
  relationTypes: [{
    key: "works_for", displayName: "Works for", description: "D-works-for", fromEntityTypeKey: "person",
    toEntityTypeKey: "company", parent: null, properties: [property("role", "D-role")],
  }],
  lenses: [
    { key: "all", name: "All", description: "D-all", indexInclusions: [] },
    {
      key: "hr", name: "HR", description: null, indexInclusions: ["people"],
      includes: { entityTypes: [{ key: "person", properties: ["name"] }], relationTypes: [] },
    },
  ],
};
const DESCRIPTIONS = ["D-person", "D-name", "D-works-for", "D-role", "D-all"];

const run = (turn: Parameters<typeof studioRun>[2] = {}) =>
  studioRun("fair", DESIGN, turn, {} as ModelingStore, {} as BaseChatModel);

describe("the Studio helper's prepared run", () => {
  it("keeps the instructions fixed and every description in a labelled block of its state", () => {
    const prepared = run();
    expect(prepared.kind).toBe("studio");
    expect(prepared.instructions).toBe(INSTRUCTIONS);
    for (const text of DESCRIPTIONS) expect(prepared.instructions).not.toContain(text);
    expect(prepared.state.map((block) => block.label)).toEqual(["Schema outline", "Lenses"]);
    const state = prepared.state.map((block) => block.text).join("\n");
    for (const text of DESCRIPTIONS) expect(state).toContain(text);
    expect(prepared.context).toEqual([]);
  });

  it("outlines the schema and each lens's scope", () => {
    const [schema, lenses] = run().state;
    expect(schema!.text).toContain("- works_for (Works for): person -> company — D-works-for");
    expect(schema!.text).toContain("  - name (name): string — D-name");
    expect(lenses!.text).toBe(
      "- all (All): shows the whole schema; search indices: none — D-all\n" +
      "- hr (HR): shows entity types person [name]; relation types none; search indices: people",
    );
  });

  it("sends the focus with the message as a block of its own, its address field by field", () => {
    const focus = run({ focus: { kind: "agent", lens: "hr", agent: "support" } }).context.at(-1)!;
    expect(focus).toEqual({ label: "Focus", source: "the Studio page the person has open", text: "kind: agent\nlens: hr\nagent: support" });
  });

  it("offers the same tools on every turn: the design tools, the serial proposal tool and the draft tool", () => {
    const { tools } = run();
    expect(tools.map((tool) => tool.name)).toEqual([
      "get_schema", "list_lenses", "list_search_indices", "validate_schema", "validate_lens", "propose_schema_change",
      "fill_draft",
    ]);
    expect(tools.filter((tool) => tool.serial).map((tool) => tool.name)).toEqual(["propose_schema_change"]);
  });
});

describe("a design address", () => {
  const valid = (address: unknown) => DesignAddress.safeParse(address).success;

  it("names each kind by its own fields, owner first, the item last", () => {
    const lines = (address: DesignAddress) => addressLines(address).join("\n");
    expect(lines({ kind: "entityType", entityType: "person" })).toBe("kind: entityType\nentityType: person");
    expect(lines({ kind: "relationType", relationType: "works_at" })).toBe("kind: relationType\nrelationType: works_at");
    expect(lines({ property: "email", entityType: "person", kind: "entityTypeProperty" }))
      .toBe("kind: entityTypeProperty\nentityType: person\nproperty: email");
    expect(lines({ kind: "relationTypeProperty", relationType: "works_at", property: "since" }))
      .toBe("kind: relationTypeProperty\nrelationType: works_at\nproperty: since");
    expect(lines({ kind: "lens", lens: "main" })).toBe("kind: lens\nlens: main");
    expect(lines({ agent: "support", lens: "main", kind: "agent" })).toBe("kind: agent\nlens: main\nagent: support");
    expect(lines({ kind: "searchIndex", searchIndex: "people" })).toBe("kind: searchIndex\nsearchIndex: people");
  });

  it("names a new item, not saved yet, by a null key of its own", () => {
    expect(addressLines({ kind: "agent", lens: "main", agent: null })).toEqual(["kind: agent", "lens: main", "agent: (new, not saved yet)"]);
    expect(valid({ kind: "entityTypeProperty", entityType: "person", property: null })).toBe(true);
    expect(valid({ kind: "agent", lens: null, agent: "support" })).toBe(false);
    expect(valid({ kind: "relationTypeProperty", relationType: null, property: "since" })).toBe(false);
  });

  it("refuses an unknown kind, a missing or empty field and a field of another kind", () => {
    expect(valid({ kind: "property", entityType: "person", property: "email" })).toBe(false);
    expect(valid({ kind: "entityTypeProperty", entityType: "person" })).toBe(false);
    expect(valid({ kind: "entityType", entityType: "" })).toBe(false);
    expect(valid({ kind: "entityTypeProperty", relationType: "works_at", property: "since" })).toBe(false);
    expect(valid({ kind: "agent", lens: "main", agent: "support", key: "support" })).toBe(false);
  });
});
