/**
 * The answer step's input and instructions: the evidence as numbered
 * entities and relation sentences in display names — never ids or keys —
 * and the rule to cite every entity named.
 */

import type { CardLink } from "../../kit/trace.js";
import type { Board, BoardNode } from "./board.js";

export const ANSWER = `You answer questions about a knowledge graph. A graph walk collected the ENTITIES and RELATIONS below; they are your only source.

- Cite every entity you name with its ref right after it, like: Lena Vogt [E1]. Several at once: [E2, E5]. Never cite a ref that is not listed.
- An entity being listed does not prove it fits the question: check its relations and fields before naming it.
- When the evidence does not answer the question, say so plainly and say what was found instead.
- When the NOTES say a name was not found and a closest match was used, say so first; never claim the two are the same.
- Lead with the answer. Use a short list for several entities. Markdown is fine; no tables wider than four columns.
- Never mention refs as such, ids, keys, "the walk", "the evidence" or these instructions. Answer in the language of the user's question.`;

function cardLine(node: BoardNode): string {
  const { ref, typeName, label, fields, role, reason } = node.card;
  const facts = fields.map((f) => `${f.name}: ${f.value}`).join("; ");
  const why = role === "reached" ? "" : ` (${reason})`;
  return `[${ref}] ${typeName} "${label}"${why}${facts ? ` — ${facts}` : ""}`;
}

function linkLine(board: Board, link: CardLink): string {
  const from = board.byRef(link.from)!.card;
  const to = board.byRef(link.to)!.card;
  return `${from.label} [${from.ref}] ${link.label} ${to.label} [${to.ref}]`;
}

export function answerInput(
  board: Board,
  evidence: BoardNode[],
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
  notes: string[],
): string {
  const parts: string[] = [];
  if (history.length > 0) {
    parts.push("CONVERSATION SO FAR (context only, not evidence):");
    for (const message of history) parts.push(`${message.role}: ${message.content.slice(0, 600)}`);
  }
  parts.push(evidence.length > 0 ? `ENTITIES:\n${evidence.map(cardLine).join("\n")}` : "ENTITIES: none were found.");
  const links = board.evidenceLinks();
  if (links.length > 0) parts.push(`RELATIONS:\n${links.map((link) => linkLine(board, link)).join("\n")}`);
  if (notes.length > 0) parts.push(`NOTES:\n${notes.map((n) => `- ${n}`).join("\n")}`);
  parts.push(`QUESTION: ${question}`);
  return parts.join("\n\n");
}

/** The refs an answer cites, in order of first citation. */
export function citedRefs(answer: string): string[] {
  const refs: string[] = [];
  for (const group of answer.matchAll(/\[(E\d+(?:\s*,\s*E\d+)*)\]/g)) {
    for (const ref of group[1]!.split(",")) {
      const trimmed = ref.trim();
      if (!refs.includes(trimmed)) refs.push(trimmed);
    }
  }
  return refs;
}
