/**
 * The deterministic middle of a navigator turn over an in-memory graph:
 * anchoring (by name, closest match, listing fallback, follow-up focus,
 * topic), following a planned path (hinted directions, self-relations,
 * dead ends), exploring (stop at a target, caps) and focusing the evidence.
 */

import { describe, expect, it } from "vitest";

import { Board, type BoardNode } from "../../../../src/runtime/assistants/kinds/navigator/board.js";
import type { Intent } from "../../../../src/runtime/assistants/kinds/navigator/understand.js";
import { anchor, explore, focus, followPath } from "../../../../src/runtime/assistants/kinds/navigator/walk.js";
import type { Row } from "../../../../src/core/ports.js";
import { entity, FakeReader, LENS, orgReader, type Edge } from "./fixture.js";

const ALL_TYPES = new Set(["person", "project", "team", "skill"]);
const ALL_RELATIONS = new Set(["manages", "works_on", "member_of", "requires", "has_kpi"]);
const intent = (overrides: Partial<Intent> = {}): Intent =>
  ({ mentions: [], targets: [], path: [], useFocus: false, search: "", ...overrides });

/** A board with the named entities as anchors. */
function anchored(reader: FakeReader, ...ids: string[]): { board: Board; anchors: BoardNode[] } {
  const board = new Board(LENS);
  const anchors = ids.map((id) => board.add(reader.byId.get(id)!, "anchor", 0, "Named", null)!);
  return { board, anchors };
}
const labels = (board: Board) => board.nodes().map((n) => n.card.label);

describe("followPath", () => {
  it("follows the planned relations hop by hop, recording how each entity was reached", async () => {
    const reader = orgReader();
    const { board, anchors } = anchored(reader, "lena");
    const result = await followPath(reader, board, LENS, anchors, [
      { relation: "manages", direction: "outgoing" },
      { relation: "works_on", direction: "outgoing" },
    ]);
    expect(result).toEqual({ hops: 2, reachedAt: 2, found: 4, followed: ["manages", "works on"], capped: false });
    // Kira's own report Tom is two manages hops away: not on this path.
    expect(labels(board)).toEqual(["Lena Vogt", "Kira Novak", "Omar Haddad", "Apollo", "Zeus"]);
    const apollo = board.node("apollo")!;
    expect(apollo.card).toMatchObject({ role: "reached", hop: 2, reason: "Kira Novak works on Apollo" });
    expect(apollo.parent).toBe(board.node("kira")!.card.ref);
    expect(board.node("kira")!.card).toMatchObject({ hop: 1, reason: "Lena Vogt manages Kira Novak" });
    // Links point as stored: from the relation's source.
    expect(board.links).toContainEqual({ from: "E1", to: "E2", type: "manages", label: "manages" });
    expect(board.links).toContainEqual({ from: "E2", to: "E4", type: "works_on", label: "works on" });
    // No other relation type was followed: no team, no skill.
    expect(board.nodes().some((n) => n.card.type === "team" || n.card.type === "skill")).toBe(false);
  });

  it("a self-relation hop takes both directions whatever the hint", async () => {
    for (const direction of ["outgoing", "incoming", "any"] as const) {
      const reader = orgReader();
      const { board, anchors } = anchored(reader, "kira");
      const result = await followPath(reader, board, LENS, anchors, [{ relation: "manages", direction }]);
      expect(result.reachedAt, direction).toBe(1);
      // Kira manages Tom and is managed by Lena: both, in one read.
      expect(labels(board).sort(), direction).toEqual(["Kira Novak", "Lena Vogt", "Tom Berg"]);
      expect(reader.calls.neighbors, direction).toHaveLength(1);
      expect(board.node("lena")!.card.reason).toBe("Lena Vogt manages Kira Novak");
      expect(board.links).toContainEqual({ from: board.node("lena")!.card.ref, to: "E1", type: "manages", label: "manages" });
    }
  });

  it("a hinted direction that finds nothing falls back to either direction", async () => {
    const reader = orgReader();
    const { board, anchors } = anchored(reader, "apollo");
    // Apollo is the target of works on, never its source.
    const result = await followPath(reader, board, LENS, anchors, [{ relation: "works_on", direction: "outgoing" }]);
    expect(result).toMatchObject({ hops: 1, reachedAt: 1, found: 1 });
    expect(board.node("kira")!.card).toMatchObject({ reason: "Kira Novak works on Apollo", hop: 1 });
    // One read in the hinted direction, one in either.
    expect(reader.calls.neighbors).toHaveLength(2);
  });

  it("a hinted direction that finds something is kept", async () => {
    const reader = orgReader();
    const { board, anchors } = anchored(reader, "kira");
    await followPath(reader, board, LENS, anchors, [{ relation: "works_on", direction: "outgoing" }]);
    expect(labels(board)).toEqual(["Kira Novak", "Apollo"]);
    expect(reader.calls.neighbors).toHaveLength(1);
  });

  it("a hop that finds nothing ends the path unreached", async () => {
    const reader = orgReader();
    const { board, anchors } = anchored(reader, "lena");
    const result = await followPath(reader, board, LENS, anchors, [
      { relation: "manages", direction: "outgoing" },
      { relation: "requires", direction: "outgoing" },
      { relation: "member_of", direction: "outgoing" },
    ]);
    expect(result).toEqual({ hops: 2, reachedAt: null, found: 2, followed: ["manages"], capped: false });
  });

  it("a path may pass through entities already on the board", async () => {
    const reader = orgReader();
    const { board, anchors } = anchored(reader, "lena", "apollo");
    const result = await followPath(reader, board, LENS, anchors, [
      { relation: "manages", direction: "outgoing" },
      { relation: "works_on", direction: "outgoing" },
      { relation: "requires", direction: "outgoing" },
    ]);
    expect(result.reachedAt).toBe(3);
    expect(board.node("k8s")!.card.reason).toBe("Apollo requires Kubernetes");
    // The anchor Apollo stays an anchor.
    expect(board.node("apollo")!.card.role).toBe("anchor");
  });
});

describe("explore", () => {
  it("walks every allowed relation breadth first and stops after the hop reaching a target type", async () => {
    const reader = orgReader();
    const { board, anchors } = anchored(reader, "lena");
    const result = await explore(reader, board, LENS, anchors, ALL_RELATIONS, new Set(["project"]), 3);
    expect(result).toMatchObject({ hops: 2, reachedAt: 2, capped: false });
    expect(result.followed.sort()).toEqual(["manages", "member of", "works on"]);
    expect(board.node("apollo")!.card.hop).toBe(2);
    // Stopped after hop 2: the skills of hop 3 were never read.
    expect(board.node("k8s")).toBeUndefined();
  });

  it("goes the full hop budget when no target type is reached", async () => {
    const reader = orgReader();
    const { board, anchors } = anchored(reader, "lena");
    const result = await explore(reader, board, LENS, anchors, ALL_RELATIONS, new Set(["skill"]), 2);
    expect(result).toMatchObject({ hops: 2, reachedAt: null });
    expect(board.node("k8s")).toBeUndefined();
    expect(board.node("apollo")).toBeDefined();
  });

  it("follows only the allowed relations", async () => {
    const reader = orgReader();
    const { board, anchors } = anchored(reader, "lena");
    const result = await explore(reader, board, LENS, anchors, new Set(["manages"]), new Set(["project"]), 3);
    expect(result.reachedAt).toBeNull();
    expect(labels(board).sort()).toEqual(["Kira Novak", "Lena Vogt", "Omar Haddad", "Tom Berg"]);
  });

  it("ends early when the frontier runs dry", async () => {
    const reader = orgReader();
    const { board, anchors } = anchored(reader, "k8s");
    const result = await explore(reader, board, LENS, anchors, new Set(["requires"]), new Set(["team"]), 3);
    expect(result).toMatchObject({ hops: 2, reachedAt: null, found: 1 });
  });

  it("expands at most 60 entities per hop and says it was capped", async () => {
    const people: Row[] = Array.from({ length: 70 }, (_, i) => entity(`p${i}`, "person", `Person ${i}`));
    const edges: Edge[] = people.map((p) => ({ type: "member_of", from: String(p._id), to: "hub" }));
    const reader = new FakeReader([entity("hub", "team", "Hub"), ...people], edges);
    const { board, anchors } = anchored(reader, "hub");
    const result = await explore(reader, board, LENS, anchors, ALL_RELATIONS, new Set(["skill"]), 2);
    // Neighbours are read 40 per entity: the hub yields 40 people.
    expect(reader.calls.neighbors[0]).toEqual(["team", "hub", 40]);
    expect(result.found).toBe(40);
    expect(result.capped).toBe(false);

    const wide = new FakeReader(
      [entity("hub", "team", "Hub"), ...people],
      // 70 people of the hub, reached through two teams each holding 35.
      [
        ...people.slice(0, 35).map((p) => ({ type: "member_of", from: String(p._id), to: "t1" })),
        ...people.slice(35).map((p) => ({ type: "member_of", from: String(p._id), to: "t2" })),
        { type: "has_kpi", from: "x", to: "t1" },
      ],
    );
    wide.byId.set("t1", entity("t1", "team", "T1"));
    wide.byId.set("t2", entity("t2", "team", "T2"));
    const second = anchored(wide, "t1", "t2");
    const capped = await explore(wide, second.board, LENS, second.anchors, new Set(["member_of"]), new Set(["skill"]), 2);
    expect(capped.found).toBe(70);
    // Hop 2 had 70 entities to expand: 60 were.
    expect(capped.capped).toBe(true);
    expect(wide.calls.neighbors).toHaveLength(2 + 60);
  });

  it("collects at most 400 entities and says it was capped", async () => {
    const people: Row[] = Array.from({ length: 40 }, (_, i) => entity(`p${i}`, "person", `Person ${i}`));
    const projects: Row[] = [];
    const edges: Edge[] = [];
    for (const person of people) {
      edges.push({ type: "member_of", from: String(person._id), to: "hub" });
      for (let j = 0; j < 39; j++) {
        const id = `${String(person._id)}-${j}`;
        projects.push(entity(id, "project", `Project ${id}`));
        edges.push({ type: "works_on", from: String(person._id), to: id });
      }
    }
    const reader = new FakeReader([entity("hub", "team", "Hub"), ...people, ...projects], edges);
    const { board, anchors } = anchored(reader, "hub");
    const result = await explore(reader, board, LENS, anchors, ALL_RELATIONS, new Set(["skill"]), 2);
    expect(result.found).toBe(400);
    expect(result.capped).toBe(true);
    expect(board.size).toBe(401);
  });
});

describe("anchor", () => {
  const run = (reader: FakeReader, plan: Partial<Intent>, previous: { id: string; type: string; label: string }[] = [], allowed = ALL_TYPES) => {
    const board = new Board(LENS);
    return { board, result: anchor(reader, board, LENS, intent(plan), previous, allowed, "the question") };
  };
  const hit = (reader: FakeReader, id: string, relativeScore: number) => ({ entity: reader.byId.get(id)!, relativeScore });

  it("a mention matching a name anchors exactly those entities, up to three", async () => {
    const reader = orgReader();
    reader.searchWith = () => [hit(reader, "kira", 1), hit(reader, "lena", 0.9)];
    const { board, result } = run(reader, { mentions: [{ text: "lena", types: ["person"] }] });
    const found = await result;
    expect(found.nodes.map((n) => n.card.label)).toEqual(["Lena Vogt"]);
    expect(found.notes).toEqual(["“lena” → Lena Vogt (Person)"]);
    expect(found.approximate).toEqual([]);
    expect(board.node("lena")!.card).toMatchObject({ role: "anchor", hop: 0, reason: "Named in the question: “lena”" });
    // One candidate type filters the search; no documents.
    expect(reader.calls.search).toEqual([["lena", "person", false, 10]]);

    const many = orgReader();
    many.searchWith = () => ["lena", "kira", "omar", "tom"].map((id) => hit(many, id, 1));
    const all = await run(many, { mentions: [{ text: "corvane", types: [] }] }).result;
    // Only the hits whose values contain the mention match by name.
    expect(all.nodes.map((n) => n.card.label)).toEqual(["Lena Vogt", "Kira Novak"]);
    const four = orgReader();
    four.searchWith = () => ["lena", "kira", "omar", "tom"].map((id) => hit(four, id, 1));
    const capped = await run(four, { mentions: [{ text: "a", types: [] }] }).result;
    expect(capped.nodes).toHaveLength(3);
  });

  it("a mention containing an entity's label matches it by name", async () => {
    const reader = orgReader();
    const found = await run(reader, { mentions: [{ text: "Apollo project", types: ["project"] }] }).result;
    // The default search finds nothing for the whole phrase; listing neither.
    expect(found.nodes).toEqual([]);
    reader.searchWith = () => [hit(reader, "apollo", 1)];
    const again = await run(reader, { mentions: [{ text: "Apollo project", types: ["project"] }] }).result;
    expect(again.nodes.map((n) => n.card.label)).toEqual(["Apollo"]);
    expect(again.approximate).toEqual([]);
  });

  it("a name that matches nothing keeps only the best hit, marked as closest match", async () => {
    const reader = orgReader();
    reader.searchWith = () => [hit(reader, "kira", 0.9), hit(reader, "omar", 0.89), hit(reader, "lena", 0.5)];
    const { board, result } = run(reader, { mentions: [{ text: "Kyra", types: [] }] });
    const found = await result;
    expect(found.nodes.map((n) => n.card.label)).toEqual(["Kira Novak"]);
    expect(found.notes).toEqual(["“Kyra” ≈ Kira Novak (Person) (closest match)"]);
    expect(found.approximate).toEqual([
      "Nothing is named “Kyra”; the closest match was used instead: Kira Novak (Person).",
    ]);
    expect(board.node("kira")!.card.reason).toBe("Closest match for “Kyra” — not the same name");
    expect(board.node("omar")).toBeUndefined();
  });

  it("a listed entity whose values contain the mention is a match by name", async () => {
    const reader = orgReader();
    reader.searchWith = () => [];
    // The listing matches the e-mail, not the name.
    const byValue = await run(reader, { mentions: [{ text: "kira@corvane", types: ["person"] }] }).result;
    expect(byValue.approximate).toEqual([]);
    expect(byValue.nodes.map((n) => n.card.label)).toEqual(["Kira Novak"]);
  });

  it("anchors only allowed types; several candidate types search unfiltered", async () => {
    const reader = orgReader();
    reader.searchWith = () => [hit(reader, "apollo", 1), hit(reader, "kira", 1)];
    const found = await run(reader, { mentions: [{ text: "o", types: ["person", "project", "team"] }] }, [], new Set(["person", "team"])).result;
    expect(found.nodes.map((n) => n.card.label)).toEqual(["Kira Novak"]);
    // Two allowed candidate types: no type filter.
    expect(reader.calls.search[0]![1]).toBeNull();
  });

  it("lists by substring per candidate type when search finds nothing it may use", async () => {
    const reader = orgReader();
    reader.searchWith = () => [];
    const found = await run(reader, { mentions: [{ text: "Haddad", types: ["person"] }] }).result;
    expect(found.nodes.map((n) => n.card.label)).toEqual(["Omar Haddad"]);
    expect(reader.calls.list).toEqual([["person", "Haddad", 3]]);

    const untyped = orgReader();
    untyped.searchWith = () => [];
    await run(untyped, { mentions: [{ text: "Zeus", types: [] }] }).result;
    // No candidate types: every allowed one.
    expect(untyped.calls.list.map((call) => call[0]).sort()).toEqual([...ALL_TYPES].sort());
  });

  it("a mention found nowhere is noted, and the topic search takes over", async () => {
    const reader = orgReader();
    reader.searchWith = (query) => (query === "robotics" ? [hit(reader, "apollo", 1), hit(reader, "zeus", 0.6), hit(reader, "kira", 0.4)] : []);
    const { board, result } = run(reader, { mentions: [{ text: "Zed", types: [] }], search: "robotics" });
    const found = await result;
    expect(found.notes).toEqual(["Nothing found for “Zed”", "Topic “robotics” → Apollo, Zeus"]);
    expect(found.nodes.map((n) => n.card.label)).toEqual(["Apollo", "Zeus"]);
    expect(board.node("zeus")!.card.reason).toBe("Matches the topic “robotics”");
    // The topic searches documents too.
    expect(reader.calls.search.at(-1)).toEqual(["robotics", null, true, 20]);
  });

  it("with neither mention nor topic phrase, the question is the topic; nothing found is noted", async () => {
    const reader = orgReader();
    reader.searchWith = () => [];
    const found = await run(reader, {}).result;
    expect(reader.calls.search).toEqual([["the question", null, true, 20]]);
    expect(found).toEqual({ nodes: [], notes: ["Nothing matches the topic “the question”"], approximate: [] });
  });

  it("a topic keeps at most six matches", async () => {
    const reader = orgReader();
    reader.searchWith = () => [...reader.byId.keys()].map((id) => hit(reader, id, 1));
    expect((await run(reader, { search: "all" }).result).nodes).toHaveLength(6);
  });

  it("a follow-up re-reads the previous answer's entities and drops vanished ones", async () => {
    const reader = orgReader();
    const previous = [
      { id: "kira", type: "person", label: "Kira Novak" },
      { id: "gone", type: "person", label: "Gone" },
      { id: "apollo", type: "project", label: "Apollo" },
    ];
    const { board, result } = run(reader, { useFocus: true }, previous);
    const found = await result;
    expect(reader.calls.entity).toEqual([["person", "kira"], ["person", "gone"], ["project", "apollo"]]);
    expect(found.nodes.map((n) => n.card.label)).toEqual(["Kira Novak", "Apollo"]);
    expect(board.node("kira")!.card).toMatchObject({ ref: "E1", role: "focus", hop: 0, reason: "From the previous answer" });
    expect(found.notes).toEqual(["Continuing from the previous answer: 2 entities"]);
    // No topic search: there is a starting point.
    expect(reader.calls.search).toEqual([]);
  });

  it("without useFocus the previous entities are not read", async () => {
    const reader = orgReader();
    await run(reader, { mentions: [{ text: "Lena", types: [] }] }, [{ id: "kira", type: "person", label: "Kira" }]).result;
    expect(reader.calls.entity).toEqual([]);
  });

  it("an entity named by two mentions is anchored once", async () => {
    const reader = orgReader();
    const found = await run(reader, { mentions: [{ text: "Lena", types: [] }, { text: "Vogt", types: [] }] }).result;
    expect(found.nodes.map((n) => n.card.ref)).toEqual(["E1"]);
    expect(found.notes).toEqual(["“Lena” → Lena Vogt (Person)", "“Vogt” → Lena Vogt (Person)"]);
  });
});

describe("focus", () => {
  async function walked() {
    const reader = orgReader();
    const { board, anchors } = anchored(reader, "lena");
    await followPath(reader, board, LENS, anchors, [
      { relation: "manages", direction: "outgoing" },
      { relation: "works_on", direction: "outgoing" },
    ]);
    return board;
  }

  it("takes anchors first, then each target with the path that reached it, then the rest by distance", async () => {
    const reader = orgReader();
    const { board, anchors } = anchored(reader, "lena");
    // Exploring two hops meets the projects and also teams and Tom.
    await explore(reader, board, LENS, anchors, ALL_RELATIONS, new Set(["skill"]), 2);
    const { evidence, targets } = focus(board, new Set(["project"]), 40);
    expect(evidence.map((n) => n.card.label)).toEqual([
      "Lena Vogt",
      // Each target right after its path.
      "Kira Novak", "Apollo", "Omar Haddad", "Zeus",
      // The rest by distance.
      "Tom Berg", "Platform", "Data",
    ]);
    expect(targets).toBe(2);
    expect(board.nodes().every((n) => n.card.evidence)).toBe(true);
  });

  it("is bound by max: a target that does not fit with its path is left out, and evidence flags say so", async () => {
    const board = await walked();
    const { evidence, targets } = focus(board, new Set(["project"]), 3);
    expect(evidence.map((n) => n.card.label)).toEqual(["Lena Vogt", "Kira Novak", "Apollo"]);
    expect(targets).toBe(1);
    expect(board.nodes().filter((n) => n.card.evidence).map((n) => n.card.label)).toEqual(["Lena Vogt", "Kira Novak", "Apollo"]);
  });

  it("anchors count toward max, and an anchor of a target type is no match", async () => {
    const reader = orgReader();
    const { board } = anchored(reader, "apollo", "zeus", "lena");
    const { evidence, targets } = focus(board, new Set(["project"]), 2);
    expect(evidence.map((n) => n.card.label)).toEqual(["Apollo", "Zeus"]);
    expect(targets).toBe(0);
  });

  it("follow-up focus entities are taken first like anchors", async () => {
    const reader = orgReader();
    const board = new Board(LENS);
    const kira = board.add(reader.byId.get("kira")!, "focus", 0, "From the previous answer", null)!;
    await followPath(reader, board, LENS, [kira], [{ relation: "member_of", direction: "outgoing" }]);
    const { evidence, targets } = focus(board, new Set(["team"]), 10);
    expect(evidence.map((n) => [n.card.label, n.card.role])).toEqual([["Kira Novak", "focus"], ["Platform", "reached"]]);
    expect(targets).toBe(1);
  });

  it("better connected targets come first", async () => {
    const reader = orgReader();
    const { board, anchors } = anchored(reader, "lena");
    await explore(reader, board, LENS, anchors, ALL_RELATIONS, new Set(["person"]), 1);
    // Both reports are hop 1 with one link each; an extra link makes Omar better connected.
    board.link(board.node("omar")!.card.ref, board.node("lena")!.card.ref, "has_kpi");
    const { evidence } = focus(board, new Set(["person"]), 10);
    expect(evidence.map((n) => n.card.label)).toEqual(["Lena Vogt", "Omar Haddad", "Kira Novak"]);
  });
});
