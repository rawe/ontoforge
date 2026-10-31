/**
 * The Studio helper's prepared run, without a store or a model: fixed
 * instructions, every description only in a labelled context block, the
 * focus as a block of its own, and exactly the design tools.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { describe, expect, it } from "vitest";

import type { ModelingStore } from "../../src/core/ports.js";
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

const run = (focus?: Parameters<typeof studioRun>[2]) =>
  studioRun("fair", DESIGN, focus, {} as ModelingStore, {} as BaseChatModel);

describe("the Studio helper's prepared run", () => {
  it("keeps the instructions fixed and every description in a labelled context block", () => {
    const prepared = run();
    expect(prepared.kind).toBe("studio");
    expect(prepared.instructions).toBe(INSTRUCTIONS);
    for (const text of DESCRIPTIONS) expect(prepared.instructions).not.toContain(text);
    expect(prepared.context.map((block) => block.label)).toEqual(["Schema outline", "Lenses"]);
    const context = prepared.context.map((block) => block.text).join("\n");
    for (const text of DESCRIPTIONS) expect(context).toContain(text);
  });

  it("outlines the schema and each lens's scope", () => {
    const [schema, lenses] = run().context;
    expect(schema!.text).toContain("- works_for (Works for): person -> company — D-works-for");
    expect(schema!.text).toContain("  - name (name): string — D-name");
    expect(lenses!.text).toBe(
      "- all (All): shows the whole schema; search indices: none — D-all\n" +
      "- hr (HR): shows entity types person [name]; relation types none; search indices: people",
    );
  });

  it("adds the focus as a block of its own, as structured fields", () => {
    const focus = run({ kind: "agent", key: "support", lensKey: "hr" }).context.at(-1)!;
    expect(focus).toEqual({ label: "Focus", source: "the Studio page the person has open", text: "kind: agent\nkey: support\nlensKey: hr" });
  });

  it("offers the design tools only", () => {
    expect(run().tools.map((tool) => tool.name)).toEqual(
      ["get_schema", "list_lenses", "list_search_indices", "validate_schema", "validate_lens"],
    );
  });
});
