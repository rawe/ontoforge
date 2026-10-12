/**
 * The evidence board: refs in discovery order, one node per entity,
 * shorter paths win for reached entities only, links once, cards in
 * display names, and relation labels as phrases.
 */

import { describe, expect, it } from "vitest";

import { relationLabel } from "../../../../src/runtime/assistants/entities.js";
import { Board } from "../../../../src/runtime/assistants/kinds/navigator/board.js";
import type { SchemaCacheValue } from "../../../../src/runtime/schemaCache.js";
import { entity, LENS } from "./fixture.js";

const lena = entity("lena", "person", "Lena Vogt", { email: "lena@corvane.example", level: 6, bio: "Long text" });
const kira = entity("kira", "person", "Kira Novak");
const apollo = entity("apollo", "project", "Apollo", { status: "active" });

describe("Board", () => {
  it("assigns refs E1, E2, … in discovery order and builds the card in display names", () => {
    const board = new Board(LENS);
    const first = board.add(lena, "anchor", 0, "Named in the question: “Lena”", null)!;
    const second = board.add(apollo, "reached", 2, "Kira Novak works on Apollo", "E1")!;
    expect(first.card).toEqual({
      ref: "E1",
      id: "lena",
      type: "person",
      typeName: "Person",
      label: "Lena Vogt",
      role: "anchor",
      hop: 0,
      reason: "Named in the question: “Lena”",
      // No name field, no document field.
      fields: [{ name: "Email", value: "lena@corvane.example" }, { name: "Level", value: "6" }],
      evidence: false,
    });
    expect(second.card.ref).toBe("E2");
    expect(second.parent).toBe("E1");
    expect(board.size).toBe(2);
    expect(board.byRef("E2")).toBe(second);
    expect(board.node("apollo")).toBe(second);
    expect(board.nodes().map((n) => n.card.ref)).toEqual(["E1", "E2"]);
  });

  it("refuses an entity of a type the lens does not show", () => {
    const board = new Board(LENS);
    expect(board.add(entity("x", "robot", "R2"), "reached", 1, "", null)).toBeNull();
    expect(board.add({ _id: "y", name: "No type" }, "reached", 1, "", null)).toBeNull();
    expect(board.size).toBe(0);
  });

  it("an entity met again keeps its first ref; a reached one moves closer by a shorter path only", () => {
    const board = new Board(LENS);
    board.add(lena, "anchor", 0, "Named", null);
    const far = board.add(apollo, "reached", 2, "far", "E1")!;
    expect(board.add(apollo, "reached", 3, "farther", "E9")).toBe(far);
    expect([far.card.hop, far.card.reason, far.parent]).toEqual([2, "far", "E1"]);
    expect(board.add(apollo, "reached", 1, "near", "E7")).toBe(far);
    expect([far.card.ref, far.card.hop, far.card.reason, far.parent]).toEqual(["E2", 1, "near", "E7"]);
    expect(board.size).toBe(2);
  });

  it("an anchor stays an anchor when reached again", () => {
    const board = new Board(LENS);
    const anchor = board.add(kira, "anchor", 0, "Named", null)!;
    board.add(kira, "reached", 1, "Lena Vogt manages Kira Novak", "E5");
    expect(anchor.card).toMatchObject({ role: "anchor", hop: 0, reason: "Named" });
    expect(anchor.parent).toBeNull();
  });

  it("records each stored relation once, by its id, labelled as a phrase", () => {
    const board = new Board(LENS);
    board.link("r1", "E1", "E2", "works_on");
    board.link("r1", "E1", "E2", "works_on");
    board.link("r2", "E2", "E1", "works_on");
    board.link("r3", "E1", "E2", "has_kpi");
    // A second stored relation of the same type between the same pair is a link of its own.
    board.link("r4", "E1", "E2", "works_on");
    expect(board.links).toEqual([
      { id: "r1", from: "E1", to: "E2", type: "works_on", label: "works on" },
      { id: "r2", from: "E2", to: "E1", type: "works_on", label: "works on" },
      { id: "r3", from: "E1", to: "E2", type: "has_kpi", label: "has KPI" },
      { id: "r4", from: "E1", to: "E2", type: "works_on", label: "works on" },
    ]);
  });

  it("evidenceLinks keeps the links between evidence cards only", () => {
    const board = new Board(LENS);
    board.add(lena, "anchor", 0, "", null)!.card.evidence = true;
    board.add(kira, "reached", 1, "", "E1")!.card.evidence = true;
    board.add(apollo, "reached", 2, "", "E2");
    board.link("r1", "E1", "E2", "manages");
    board.link("r2", "E2", "E3", "works_on");
    expect(board.evidenceLinks()).toEqual([{ id: "r1", from: "E1", to: "E2", type: "manages", label: "manages" }]);
  });

  it("cards carry at most six fields, each value cut to 200 characters", () => {
    const wide = {
      ...LENS,
      entityTypes: {
        thing: {
          key: "thing", displayName: "Thing", description: null, nameProperty: "name",
          properties: Object.fromEntries(["name", "a", "b", "c", "d", "e", "f", "g", "h", "i"].map((key) =>
            [key, { key, displayName: key.toUpperCase(), description: null, dataType: "string", required: false, defaultValue: null }])),
        },
      },
    } as unknown as SchemaCacheValue;
    const board = new Board(wide);
    const node = board.add(
      { _id: "t", _entityTypeKey: "thing", name: "T", a: "x".repeat(300), b: "", c: null, d: true, e: 1, f: { k: 1 }, g: "g", h: "h", i: "i" },
      "anchor", 0, "", null,
    )!;
    // Empty and null values are skipped; at most six.
    expect(node.card.fields.map((f) => f.name)).toEqual(["A", "D", "E", "F", "G", "H"]);
    expect(node.card.fields[0]!.value).toBe(`${"x".repeat(199)}…`);
    expect(node.card.fields.slice(1).map((f) => f.value)).toEqual(["true", "1", '{"k":1}', "g", "h"]);
  });

  it("an entity without a name value is labelled by its id", () => {
    const board = new Board(LENS);
    expect(board.add({ _id: "nameless", _entityTypeKey: "team" }, "anchor", 0, "", null)!.card.label).toBe("nameless");
  });
});

describe("relationLabel", () => {
  const lens = (displayName: string) =>
    ({ relationTypes: { r: { displayName } } }) as unknown as SchemaCacheValue;

  it("lowercases words and keeps acronyms", () => {
    expect(relationLabel(LENS, "works_on")).toBe("works on");
    expect(relationLabel(LENS, "has_kpi")).toBe("has KPI");
    expect(relationLabel(lens("Reports To CTO Of"), "r")).toBe("reports to CTO of");
    // A one-letter word is no acronym.
    expect(relationLabel(lens("Is A Member"), "r")).toBe("is a member");
  });

  it("an unknown relation type is labelled by its key", () => {
    expect(relationLabel(LENS, "ghost_rel")).toBe("ghost_rel");
  });
});
