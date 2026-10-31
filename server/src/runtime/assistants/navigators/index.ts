/**
 * The Navigator: answers questions by walking the graph — the multi-hop
 * questions a ranked search cannot answer and an open tool loop answers
 * slowly. One turn is a fixed LangGraph pipeline with two model calls:
 *
 *   understand ─► anchor ─► walk ─► focus ─► answer ─► remember
 *                             ↻ widen once when not everything asked for was reached
 *
 * understand plans a path — the relations from what the question names to
 * what it asks for, in order — and walk follows it hop by hop; without a
 * path, or when it reached nothing, walk explores breadth first.
 *
 * understand and answer call the model; anchor, walk and focus read the
 * lens only (`walk.ts`). Every entity met is streamed to the client before
 * the answer, which cites them by ref. The thread keeps the conversation
 * and the entities the last answer cited, where a follow-up may start.
 *
 * A turn's working values (history, intent, anchors, walks, evidence,
 * reply) live in the closure of `run`, which compiles its graph per turn,
 * so the graph only sequences the steps and checkpoints the thread.
 */

import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import { Annotation, END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";

import type { GraphThread } from "../../../assistants/index.js";
import type { RuntimeStore } from "../../../core/ports.js";
import type { LoadedSchema } from "../../schemaCache.js";
import { decide, streamAnswer, turnModel } from "../kit/model.js";
import type { Topology, Trace } from "../kit/trace.js";
import { ANSWER, answerInput, citedRefs } from "./answer.js";
import { Board, type BoardNode } from "./board.js";
import { allowedAnchors, allowedRelations, type NavigatorConfig } from "./config.js";
import { lensReader } from "./reader.js";
import {
  intentSchema, intentSummary, parseIntent, pathText, schemaText, understandInput, UNDERSTAND, type Intent,
} from "./understand.js";
import { anchor, explore, focus, followPath, type FocusEntity, type WalkResult } from "./walk.js";

/** The event prefix and the noun: `navigator.graph`, `navigator.step`,
 * `navigator.summary`. */
export const NAVIGATOR_EVENT = "navigator";

/** The built-in default's runtime list description. */
export const NAVIGATOR_DEFAULT_DESCRIPTION =
  "Walks the lens's graph: finds what the question names, follows every relation the lens shows up to two hops, and answers citing what it found.";

/** The steps of a turn, announced before it runs. */
export const NAVIGATOR_TOPOLOGY: Topology = {
  steps: [
    { id: "understand", label: "Understand", model: true,
      description: "Reads the question: what to look for, where to start, which relations matter." },
    { id: "anchor", label: "Anchor", model: false,
      description: "Finds the entities the question names, through the lens's search." },
    { id: "walk", label: "Walk", model: false,
      description: "Follows the planned path from the anchors hop by hop — or explores every relation outward." },
    { id: "focus", label: "Focus", model: false,
      description: "Keeps what answers the question and the paths that lead there." },
    { id: "answer", label: "Answer", model: true,
      description: "Writes the answer from the focused entities only, citing them." },
  ],
  edges: [
    { from: "understand", to: "anchor" },
    { from: "anchor", to: "walk" },
    { from: "walk", to: "focus" },
    { from: "walk", to: "walk", label: "widen: not everything asked for was reached" },
    { from: "focus", to: "answer" },
  ],
};

/** What one turn runs with. */
export interface NavigatorTurn {
  /** The navigator's key, `_default` for the derived one. */
  key: string;
  config: NavigatorConfig;
  lensKey: string;
  store: RuntimeStore;
  loaded: LoadedSchema;
  message: string;
  thread: GraphThread;
  signal: AbortSignal;
  trace: Trace;
}

/** Entities a follow-up may start from. */
const FOCUS_CARRIED = 20;

const State = Annotation.Root({
  // Kept with the thread: the conversation, and where a follow-up may start.
  ...MessagesAnnotation.spec,
  carried: Annotation<FocusEntity[] | undefined>(),
  // The walk's round, for the widen decision.
  round: Annotation<number>(),
});

type Message = { role: "user" | "assistant"; content: string };

/** The conversation the model calls see: the whole thread. */
function historyOf(messages: BaseMessage[]): Message[] {
  return messages.map((m) => ({
    role: m.getType() === "human" ? "user" : "assistant",
    content: m.text,
  }));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Runs one turn on its thread and returns the answer. */
export async function run(turn: NavigatorTurn): Promise<string> {
  const { config, loaded, message, signal, trace, thread } = turn;
  const lens = loaded.scoped;
  const reader = lensReader(turn.lensKey, turn.store);
  const relations = allowedRelations(config, lens);
  const anchorTypes = allowedAnchors(config, lens);
  const model = turnModel();
  const board = new Board(lens);

  // One turn's working values; the thread keeps none of them.
  let history: Message[] = [];
  let previous: FocusEntity[] = [];
  let intent: Intent = { mentions: [], targets: [], path: [], useFocus: false, search: "" };
  let anchors: BoardNode[] = [];
  const walks: (WalkResult & { planned: boolean })[] = [];
  let evidence: BoardNode[] = [];
  const notes: string[] = [];
  let reply = "";

  const targets = () => new Set(intent.targets);

  const graph = new StateGraph(State)
    .addNode("understand", async (state) => {
      history = historyOf(state.messages.slice(0, -1));
      previous = state.carried ?? [];
      intent = await trace.step("understand", async (report) => {
        const raw = await decide(
          model, trace, "navigator_intent",
          intentSchema(Object.keys(lens.entityTypes), [...anchorTypes], [...relations]),
          UNDERSTAND,
          understandInput(schemaText(lens, relations, anchorTypes), message, history, previous),
          signal,
        );
        const parsed = parseIntent(raw, lens, relations, anchorTypes);
        report.summary = intentSummary(parsed, lens);
        return parsed;
      });
      return { round: 0 };
    })
    .addNode("anchor", async () => {
      anchors = await trace.step("anchor", async (report) => {
        const found = await anchor(reader, board, lens, intent, previous, anchorTypes, message);
        report.summary = found.notes.join(" · ");
        notes.push(...found.approximate);
        return found.nodes;
      });
      if (anchors.length === 0) notes.push("No entity of the question was found in the graph.");
      await trace.entities(board.nodes().map((n) => n.card), board.links);
      return {};
    })
    .addNode("walk", async (state) => {
      const round = state.round + 1;
      if (anchors.length === 0) {
        await trace.skip("walk", "Nothing to walk from");
        return { round };
      }
      // Round one follows the planned path; without one, or when it
      // reached nothing, the walk explores every allowed relation.
      const planned = round === 1 && intent.path.length > 0;
      // Widening an exploration goes one hop further than the first round.
      const hops = round > 1 && walks[0]?.planned === false ? Math.min(3, config.hops + 1) : config.hops;
      const result = await trace.step("walk", async (report) => {
        const walked = planned
          ? await followPath(reader, board, lens, anchors, intent.path)
          : await explore(reader, board, lens, anchors, relations, targets(), hops);
        const how = planned ? `Path ${pathText(intent.path, lens)}` : `Explored ${plural(walked.hops, "hop", "hops")}`;
        const reached = walked.reachedAt === null
          ? planned ? " · the path ends without a match" : ""
          : intent.targets.length > 0
            ? ` · reached ${intent.targets.map((t) => lens.entityTypes[t]?.displayName ?? t).join(", ")} at hop ${walked.reachedAt}`
            : "";
        report.summary = `${how}: ${plural(walked.found, "entity", "entities")}${reached}`;
        return walked;
      });
      walks.push({ ...result, planned });
      if (result.capped) notes.push("The graph around these entities is large; only the closest part was read.");
      await trace.entities(board.nodes().map((n) => n.card), board.links);
      return { round };
    })
    .addNode("focus", async () => {
      if (board.size === 0) {
        await trace.skip("focus", "Nothing to focus on");
        return {};
      }
      const kept = await trace.step("focus", async (report) => {
        const focused = focus(board, targets(), config.maxEntities);
        const targetNames = intent.targets.map((t) => lens.entityTypes[t]?.displayName ?? t).join(", ");
        report.summary = `Kept ${focused.evidence.length} of ${board.size}` +
          (intent.targets.length > 0 ? ` · ${plural(focused.targets, "match", "matches")} of ${targetNames} with their paths` : "");
        return focused;
      });
      evidence = kept.evidence;
      if (board.size > evidence.length) notes.push(`${board.size - evidence.length} more entities were found but not shown.`);
      if (walks.length > 1) {
        notes.push(walks[0]!.planned
          ? "The planned route did not reach everything asked for, so the walk also explored every relation."
          : "The first walk reached nothing asked for, so it went one hop further.");
      }
      await trace.entities(board.nodes().map((n) => n.card), board.links);
      return {};
    })
    .addConditionalEdges("walk", (state) => {
      const last = walks.at(-1);
      if (state.round !== 1 || last === undefined) return "focus";
      // Widen once: a planned path that reached nothing or missed a target
      // type, or an exploration that reached no target type.
      // Entities carried over from the previous answer count: a follow-up asks about them.
      const reached = new Set(board.nodes().filter((n) => n.card.role !== "anchor").map((n) => n.card.type));
      const missed = intent.targets.some((t) => !reached.has(t));
      const widen = last.planned
        ? last.reachedAt === null || missed
        : last.reachedAt === null && intent.targets.length > 0 && config.hops < 3;
      return widen ? "walk" : "focus";
    }, ["walk", "focus"])
    .addNode("answer", async () => {
      reply = await trace.step("answer", async (report) => {
        const text = await streamAnswer(
          model, trace,
          config.instructions ? `${ANSWER}\n\nADDITIONAL INSTRUCTIONS:\n${config.instructions}` : ANSWER,
          answerInput(board, evidence, message, history, notes),
          signal,
          (delta) => trace.delta(delta),
        );
        const cited = citedRefs(text).filter((ref) => board.byRef(ref)?.card.evidence);
        report.summary = `Cited ${plural(cited.length, "entity", "entities")}`;
        return text;
      });
      return {};
    })
    // The turn joins the thread; what it cited is where a follow-up starts.
    .addNode("remember", async (state) => {
      const cited = citedRefs(reply)
        .map((ref) => board.byRef(ref))
        .filter((node): node is BoardNode => node !== undefined && node.card.evidence);
      const carried = (cited.length > 0 ? cited : evidence.filter((n) => n.card.role !== "anchor"))
        .slice(0, FOCUS_CARRIED)
        .map((n) => ({ id: n.card.id, type: n.card.type, label: n.card.label }));
      return { messages: [new AIMessage(reply)], carried };
    })
    .addEdge(START, "understand")
    .addEdge("understand", "anchor")
    .addEdge("anchor", "walk")
    .addEdge("focus", "answer")
    .addEdge("answer", "remember")
    .addEdge("remember", END)
    .compile({ checkpointer: thread.checkpointer });

  await graph.invoke(
    { messages: [new HumanMessage(message)] },
    { signal, configurable: { thread_id: thread.threadId } },
  );
  await trace.summary({
    entities: board.size,
    evidence: evidence.length,
    hops: walks.reduce((max, w) => Math.max(max, w.hops), 0),
  });
  return reply;
}
