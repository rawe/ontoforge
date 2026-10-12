/**
 * The understand step's contract with the model: the structured-output
 * schema, the parsing that never trusts the output, the schema and input
 * the model reads, and the plain-words summary.
 */

import { describe, expect, it } from "vitest";

import {
  intentSchema,
  intentSummary,
  parseIntent,
  pathText,
  schemaText,
  understandInput,
  type Intent,
} from "../../../../src/runtime/assistants/kinds/navigator/understand.js";
import { LENS } from "./fixture.js";

const RELATIONS = new Set(["manages", "works_on", "member_of", "requires"]);
const ANCHORS = new Set(["person", "project"]);
const parse = (raw: unknown) => parseIntent(raw, LENS, RELATIONS, ANCHORS);
const intent = (overrides: Partial<Intent> = {}): Intent =>
  ({ mentions: [], targets: [], path: [], useFocus: false, search: "", ...overrides });

describe("parseIntent", () => {
  it("drops unknown or disallowed types and relations, trims mentions and drops empty ones", () => {
    const parsed = parse({
      mentions: [
        { text: "  Lena  ", types: ["person", "robot", "team"] },
        { text: "   ", types: ["person"] },
        { text: 5, types: [] },
        null,
        { text: "Apollo" },
      ],
      targets: ["project", "ghost", "project", "team", 7],
      path: [
        { relation: "manages", direction: "outgoing" },
        { relation: "ghost", direction: "incoming" },
        { relation: "has_kpi", direction: "outgoing" },
        { relation: "works_on", direction: "sideways" },
      ],
      useFocus: false,
      search: "",
    });
    expect(parsed).toEqual({
      // Mention types: only the allowed anchor types.
      mentions: [{ text: "Lena", types: ["person"] }, { text: "Apollo", types: [] }],
      // Targets: any entity type the lens shows, once each.
      targets: ["project", "team"],
      // Path: only relations the navigator may follow; an unknown direction is "any".
      path: [{ relation: "manages", direction: "outgoing" }, { relation: "works_on", direction: "any" }],
      useFocus: false,
      search: "",
    });
  });

  it("caps the path at 3 hops and the mentions at 5, each mention at 200 characters", () => {
    const parsed = parse({
      mentions: Array.from({ length: 7 }, (_, i) => ({ text: `m${i}${"x".repeat(300)}`, types: [] })),
      path: ["manages", "works_on", "requires", "member_of"].map((relation) => ({ relation, direction: "incoming" })),
    });
    expect(parsed.mentions).toHaveLength(5);
    expect(parsed.mentions[0]!.text).toHaveLength(200);
    expect(parsed.path.map((step) => step.relation)).toEqual(["manages", "works_on", "requires"]);
    expect(parsed.path.every((step) => step.direction === "incoming")).toBe(true);
  });

  it("defaults a missing direction to any; useFocus only when exactly true; search a string, cut", () => {
    const parsed = parse({ path: [{ relation: "manages" }], useFocus: "yes", search: "s".repeat(300) });
    expect(parsed.path).toEqual([{ relation: "manages", direction: "any" }]);
    expect(parsed.useFocus).toBe(false);
    expect(parsed.search).toHaveLength(200);
    expect(parse({ useFocus: true, search: 5 })).toMatchObject({ useFocus: true, search: "" });
  });

  it("anything unreadable is an empty intent", () => {
    for (const raw of [null, undefined, "text", 3, [], { mentions: "Lena", targets: {}, path: "manages" }]) {
      expect(parse(raw), JSON.stringify(raw)).toEqual(intent());
    }
  });
});

describe("intentSchema", () => {
  type Schema = Record<string, any>;
  const objects = (schema: Schema): Schema[] => [
    schema,
    schema.properties.mentions.items,
    schema.properties.path.items,
  ];

  it("requires every property and allows no others, at every object level", () => {
    const schema = intentSchema(["person"], ["person"], ["manages"]) as Schema;
    expect(schema.type).toBe("object");
    for (const object of objects(schema)) {
      expect(object.additionalProperties).toBe(false);
      expect([...object.required].sort()).toEqual(Object.keys(object.properties).sort());
    }
    expect(Object.keys(schema.properties)).toEqual(["mentions", "targets", "path", "useFocus", "search"]);
  });

  it("constrains keys to the given lists, the direction always", () => {
    const schema = intentSchema(["person", "project"], ["person"], ["manages", "works_on"]) as Schema;
    expect(schema.properties.targets.items).toEqual({ type: "string", enum: ["person", "project"] });
    expect(schema.properties.mentions.items.properties.types.items).toEqual({ type: "string", enum: ["person"] });
    expect(schema.properties.path.items.properties.relation).toEqual({ type: "string", enum: ["manages", "works_on"] });
    expect(schema.properties.path.items.properties.direction).toEqual({ type: "string", enum: ["outgoing", "incoming", "any"] });
  });

  it("an empty list has no enum: providers refuse an empty one", () => {
    const schema = intentSchema([], [], []) as Schema;
    expect(schema.properties.targets.items).toEqual({ type: "string" });
    expect(schema.properties.mentions.items.properties.types.items).toEqual({ type: "string" });
    expect(schema.properties.path.items.properties.relation).toEqual({ type: "string" });
  });
});

describe("what the model reads", () => {
  it("the schema lists every entity type, marks those no mention may be, and only the allowed relations", () => {
    const text = schemaText(LENS, new Set(["manages", "works_on"]), new Set(["person"]));
    expect(text).toContain("- person: Person — Persons of the org");
    expect(text).not.toContain("- person: Person — Persons of the org [never a mention]");
    expect(text).toContain("- project: Project — Projects of the org [never a mention]");
    expect(text).toContain("- manages: person → person — Manages");
    expect(text).toContain("- works_on: person → project — Works On");
    expect(text).not.toContain("requires");
    expect(text.indexOf("ENTITY TYPES")).toBeLessThan(text.indexOf("RELATION TYPES"));
  });

  it("the input carries the conversation, the previous answer's entities and the question last", () => {
    const input = understandInput(
      "SCHEMA",
      "And their teams?",
      [{ role: "user", content: "Who reports to Lena?" }, { role: "assistant", content: "x".repeat(700) }],
      [{ id: "kira", type: "person", label: "Kira Novak" }, { id: "omar", type: "person", label: "Omar Haddad" }],
    );
    expect(input.split("\n\n")).toEqual([
      "SCHEMA",
      "CONVERSATION (oldest first):",
      "user: Who reports to Lena?",
      `assistant: ${"x".repeat(600)}`,
      "ENTITIES OF THE PREVIOUS ANSWER: Kira Novak (person); Omar Haddad (person)",
      "QUESTION: And their teams?",
    ]);
    expect(understandInput("SCHEMA", "Who?", [], [])).toBe("SCHEMA\n\nQUESTION: Who?");
  });
});

describe("the step summary", () => {
  it("says what the walk looks for, where it starts and the path, in display names", () => {
    expect(intentSummary(intent({
      targets: ["project", "team"],
      mentions: [{ text: "Lena", types: ["person"] }, { text: "Apollo", types: [] }],
      path: [{ relation: "manages", direction: "outgoing" }, { relation: "works_on", direction: "incoming" }],
    }), LENS)).toBe("Looking for Project, Team · starting at “Lena”, “Apollo” · path manages → works on (backwards)");
  });

  it("names a follow-up; a topic only without mentions or follow-up", () => {
    expect(intentSummary(intent({ useFocus: true, search: "robots" }), LENS)).toBe("continuing from the previous answer");
    expect(intentSummary(intent({ search: "robots" }), LENS)).toBe("topic “robots”");
    expect(intentSummary(intent({ mentions: [{ text: "Lena", types: [] }], search: "robots" }), LENS)).toBe("starting at “Lena”");
    expect(intentSummary(intent(), LENS)).toBe("No starting point in the question");
  });

  it("pathText lowercases display names and marks backward hops", () => {
    expect(pathText([
      { relation: "member_of", direction: "any" },
      { relation: "requires", direction: "incoming" },
      { relation: "ghost", direction: "outgoing" },
    ], LENS)).toBe("member of → requires (backwards) → ghost");
  });
});
