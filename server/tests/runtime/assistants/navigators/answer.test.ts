/**
 * The answer step's input and citations: evidence only, relation sentences
 * between evidence only, notes and history, no ids or keys; refs parsed
 * from the answer in order of first citation.
 */

import { describe, expect, it } from "vitest";

import { ANSWER, answerInput, citedRefs } from "../../../../src/runtime/assistants/kinds/navigator/answer.js";
import { Board } from "../../../../src/runtime/assistants/kinds/navigator/board.js";
import { entity, LENS } from "./fixture.js";

describe("citedRefs", () => {
  it("reads single and grouped refs in order of first citation, once each", () => {
    expect(citedRefs("Lena [E1] manages Kira [E2] and Omar [E3]. Both [E2, E3] work on [E5,E4] and [E2].")).toEqual([
      "E1", "E2", "E3", "E5", "E4",
    ]);
    expect(citedRefs("Group with spaces [E2 ,  E7]")).toEqual(["E2", "E7"]);
    expect(citedRefs("[E12] and [E1]")).toEqual(["E12", "E1"]);
  });

  it("ignores anything that is no evidence ref", () => {
    expect(citedRefs("None here [X1], [e2], [E], E3, (E4), [1]")).toEqual([]);
    expect(citedRefs("")).toEqual([]);
  });
});

describe("answerInput", () => {
  function board() {
    const b = new Board(LENS);
    const lena = b.add(entity("lena-uuid", "person", "Lena Vogt", { email: "lena@corvane.example" }), "anchor", 0, "Named in the question: “Lena”", null)!;
    const kira = b.add(entity("kira-uuid", "person", "Kira Novak"), "reached", 1, "Lena Vogt manages Kira Novak", "E1")!;
    const apollo = b.add(entity("apollo-uuid", "project", "Apollo", { status: "active" }), "reached", 2, "Kira Novak works on Apollo", "E2")!;
    b.add(entity("zeus-uuid", "project", "Zeus"), "reached", 2, "x", "E2");
    b.link("r1", "E1", "E2", "manages");
    b.link("r2", "E2", "E3", "works_on");
    b.link("r3", "E2", "E4", "works_on");
    for (const node of [lena, kira, apollo]) node.card.evidence = true;
    return { b, evidence: [lena, kira, apollo] };
  }

  it("lists the evidence and the relations among it in display names, the question last", () => {
    const { b, evidence } = board();
    const input = answerInput(b, evidence, "Who works on what?", [], []);
    expect(input).toBe([
      "ENTITIES:",
      "[E1] Person \"Lena Vogt\" (Named in the question: “Lena”) — Email: lena@corvane.example",
      "[E2] Person \"Kira Novak\"",
      "[E3] Project \"Apollo\" — Status: active",
      "",
      "RELATIONS:",
      "Lena Vogt [E1] manages Kira Novak [E2]",
      "Kira Novak [E2] works on Apollo [E3]",
      "",
      "QUESTION: Who works on what?",
    ].join("\n"));
    // Not evidence: never shown, nor its relation.
    expect(input).not.toContain("Zeus");
    expect(input).not.toContain("E4");
    // No ids or keys.
    for (const internal of ["uuid", "works_on", "person", "project"]) expect(input).not.toContain(internal);
  });

  it("puts the conversation first, each message cut to 600 characters, and the notes before the question", () => {
    const { b, evidence } = board();
    const input = answerInput(
      b, evidence, "And?",
      [{ role: "user", content: "Who?" }, { role: "assistant", content: "y".repeat(700) }],
      ["Nothing is named “Lina”; the closest match was used instead: Lena Vogt (Person).", "3 more entities were found but not shown."],
    );
    const parts = input.split("\n\n");
    expect(parts.slice(0, 3)).toEqual([
      "CONVERSATION SO FAR (context only, not evidence):",
      "user: Who?",
      `assistant: ${"y".repeat(600)}`,
    ]);
    expect(parts.at(-2)).toBe(
      "NOTES:\n- Nothing is named “Lina”; the closest match was used instead: Lena Vogt (Person).\n- 3 more entities were found but not shown.",
    );
    expect(parts.at(-1)).toBe("QUESTION: And?");
  });

  it("says so when nothing was found, and lists no relations", () => {
    const b = new Board(LENS);
    expect(answerInput(b, [], "Who?", [], [])).toBe("ENTITIES: none were found.\n\nQUESTION: Who?");
  });

  it("the instructions ask for citations and the question's language", () => {
    expect(ANSWER).toContain("Cite every entity you name with its ref");
    expect(ANSWER).toContain("Answer in the language of the user's question");
  });
});
