/**
 * The deterministic middle of a navigator turn — no model call:
 *
 * - **anchor**: the entities the question names, resolved through the
 *   lens's search (a listing by substring when search finds nothing), the
 *   previous turn's entities when the question refers back to them, or —
 *   when the question names nothing — the best matches of its topic;
 * - **walk**: along the path the understand step planned, hop by hop
 *   (`followPath`), or — without a path, or when it reached nothing —
 *   breadth first along the allowed relations, stopping after the hop that
 *   first reaches an entity of a target type (`explore`);
 * - **focus**: the evidence the answer receives — anchors, the targets
 *   best connected to them and the paths that lead there, bounded.
 */

import type { Row } from "../../../../core/ports.js";
import type { SchemaCacheValue } from "../../../schemaCache.js";
import { entityLabel, relationLabel } from "../../entities.js";
import { Board, type BoardNode } from "./board.js";
import type { Intent, PathStep } from "./understand.js";
import type { GraphReader } from "./reader.js";

/** Hits kept per mention. */
const HITS_PER_MENTION = 3;
/** Topic matches kept when the question names nothing. */
const TOPIC_ANCHORS = 6;
const TOPIC_SCORE_RATIO = 0.5;
/** Neighbours read per entity and hop. */
const NEIGHBORS_PER_ENTITY = 40;
/** Entities expanded per hop, closest first. */
const FRONTIER = 60;
/** Entities one walk collects at most. */
const WALK_CAP = 400;
/** Neighbour reads in flight at once. */
const PARALLEL_READS = 8;

/** An entity a follow-up may start from: the previous turn's cited evidence. */
export interface FocusEntity {
  id: string;
  type: string;
  label: string;
}

const normalized = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

function quote(text: string): string {
  return `“${text}”`;
}

/** At most `size` promises in flight, results in input order. */
async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  }
  return results;
}

export interface AnchorResult {
  nodes: BoardNode[];
  /** One line per mention, focus and topic search, for the step summary. */
  notes: string[];
  /** What the answer must say: mentions only matched approximately. */
  approximate: string[];
}

/** A mention resolved: by name, or only approximately. */
interface Resolved {
  entities: Row[];
  exact: boolean;
}

/**
 * Resolves one mention. Entities whose values contain the mention (or the
 * mention contains their label) are matches by name, up to three. Without
 * one, the best search hit alone is kept, as an approximate match — a name
 * that does not exist must never silently become another entity.
 */
async function resolveMention(
  reader: GraphReader,
  lens: SchemaCacheValue,
  text: string,
  types: string[],
  allowed: Set<string>,
): Promise<Resolved> {
  const candidateTypes = types.filter((t) => allowed.has(t));
  const typeFilter = candidateTypes.length === 1 ? candidateTypes[0]! : null;
  const accepted = (entity: Row) => {
    const type = String(entity._entityTypeKey ?? "");
    return allowed.has(type) && (candidateTypes.length === 0 || candidateTypes.includes(type));
  };
  let hits = (await reader.search(text, typeFilter, false, 10)).filter((hit) => accepted(hit.entity));
  if (hits.length === 0) {
    // Search found nothing it may use: list by substring per candidate type.
    const listTypes = (candidateTypes.length > 0 ? candidateTypes : [...allowed]).slice(0, 12);
    const listed = (await Promise.all(listTypes.map((t) => reader.list(t, text, HITS_PER_MENTION)))).flat();
    hits = listed.map((entity) => ({ entity, relativeScore: 1 }));
  }
  if (hits.length === 0) return { entities: [], exact: false };
  const wanted = normalized(text);
  const byName = hits.filter((hit) => {
    const type = lens.entityTypes[String(hit.entity._entityTypeKey ?? "")];
    const label = type ? normalized(entityLabel(hit.entity, type)) : "";
    const values = normalized(Object.values(hit.entity).filter((v) => typeof v === "string").join(" | "));
    return values.includes(wanted) || (label.length > 2 && wanted.includes(label));
  });
  if (byName.length > 0) return { entities: byName.slice(0, HITS_PER_MENTION).map((h) => h.entity), exact: true };
  // Without a match by name, only the single best hit — never a spread of guesses.
  return { entities: [hits[0]!.entity], exact: false };
}

export async function anchor(
  reader: GraphReader,
  board: Board,
  lens: SchemaCacheValue,
  intent: Intent,
  previous: FocusEntity[],
  allowed: Set<string>,
  question: string,
): Promise<AnchorResult> {
  const notes: string[] = [];
  const approximate: string[] = [];
  const nodes: BoardNode[] = [];
  const resolved = await Promise.all(
    intent.mentions.map((mention) => resolveMention(reader, lens, mention.text, mention.types, allowed)),
  );
  intent.mentions.forEach((mention, i) => {
    const { entities, exact } = resolved[i]!;
    const reason = exact
      ? `Named in the question: ${quote(mention.text)}`
      : `Closest match for ${quote(mention.text)} — not the same name`;
    const found = entities
      .map((entity) => board.add(entity, "anchor", 0, reason, null))
      .filter((node): node is BoardNode => node !== null);
    nodes.push(...found);
    const labels = found.map((n) => `${n.card.label} (${n.card.typeName})`).join(", ");
    notes.push(found.length === 0
      ? `Nothing found for ${quote(mention.text)}`
      : exact ? `${quote(mention.text)} → ${labels}` : `${quote(mention.text)} ≈ ${labels} (closest match)`);
    if (found.length > 0 && !exact) {
      approximate.push(`Nothing is named ${quote(mention.text)}; the closest match was used instead: ${labels}.`);
    }
  });

  if (intent.useFocus && previous.length > 0) {
    const current = await Promise.all(previous.map((f) => reader.entity(f.type, f.id)));
    const kept = current
      .filter((entity): entity is Row => entity !== null)
      .map((entity) => board.add(entity, "focus", 0, "From the previous answer", null))
      .filter((node): node is BoardNode => node !== null);
    nodes.push(...kept);
    notes.push(`Continuing from the previous answer: ${kept.length} ${kept.length === 1 ? "entity" : "entities"}`);
  }

  if (nodes.length === 0) {
    const topic = intent.search.trim() || question;
    const hits = (await reader.search(topic, null, true, 20))
      .filter((hit) => allowed.has(String(hit.entity._entityTypeKey ?? "")));
    const best = hits[0]?.relativeScore ?? 0;
    const kept = hits
      .filter((hit) => hit.relativeScore >= TOPIC_SCORE_RATIO * best)
      .slice(0, TOPIC_ANCHORS)
      .map((hit) => board.add(hit.entity, "anchor", 0, `Matches the topic ${quote(topic)}`, null))
      .filter((node): node is BoardNode => node !== null);
    nodes.push(...kept);
    notes.push(kept.length > 0
      ? `Topic ${quote(topic)} → ${kept.map((n) => n.card.label).join(", ")}`
      : `Nothing matches the topic ${quote(topic)}`);
  }
  return { nodes: [...new Map(nodes.map((n) => [n.card.id, n])).values()], notes, approximate };
}

export interface WalkResult {
  /** Hops walked. */
  hops: number;
  /** The hop that first reached a target — for a path, its last hop — or null. */
  reachedAt: number | null;
  /** Entities this walk added to the board. */
  found: number;
  /** Relation types the walk followed, as phrases. */
  followed: string[];
  capped: boolean;
}

/** Which neighbours one hop may take. */
interface HopRule {
  relations: Set<string>;
  direction: PathStep["direction"];
}

/**
 * One hop from `frontier`: reads the neighbours, adds those the rule allows
 * to the board with the relation that reached them, and returns them — the
 * entities already on the board too, so a path may pass through them.
 */
async function hop(
  reader: GraphReader,
  board: Board,
  lens: SchemaCacheValue,
  frontier: BoardNode[],
  depth: number,
  rule: HopRule,
  state: { walked: number; capped: boolean; followed: Set<string> },
): Promise<BoardNode[]> {
  const expanding = frontier.slice(0, FRONTIER);
  if (frontier.length > FRONTIER) state.capped = true;
  const reads = await inBatches(expanding, PARALLEL_READS, (node) =>
    reader.neighbors(node.card.type, node.card.id, NEIGHBORS_PER_ENTITY));
  const next = new Map<string, BoardNode>();
  expanding.forEach((node, i) => {
    for (const { relation, entity } of reads[i]!) {
      const relationType = String(relation._relationTypeKey ?? "");
      if (!rule.relations.has(relationType)) continue;
      if (rule.direction !== "any" && relation.direction !== rule.direction) continue;
      const type = lens.entityTypes[String(entity._entityTypeKey ?? "")];
      if (type === undefined) continue;
      const known = board.node(String(entity._id));
      if (known === undefined && state.walked >= WALK_CAP) {
        state.capped = true;
        continue;
      }
      const outgoing = relation.direction === "outgoing";
      const parent = node.card;
      const phrase = relationLabel(lens, relationType);
      const label = entityLabel(entity, type);
      const reason = outgoing ? `${parent.label} ${phrase} ${label}` : `${label} ${phrase} ${parent.label}`;
      const reached = board.add(entity, "reached", depth, reason, parent.ref);
      if (reached === null) continue;
      if (known === undefined) state.walked++;
      board.link(String(relation._id), outgoing ? parent.ref : reached.card.ref, outgoing ? reached.card.ref : parent.ref, relationType);
      state.followed.add(phrase);
      if (reached.card.id !== parent.id) next.set(reached.card.id, reached);
    }
  });
  return [...next.values()];
}

/**
 * Explores breadth first along `relations` up to `hops` hops, stopping
 * after the hop that first reaches an entity of a target type.
 */
export async function explore(
  reader: GraphReader,
  board: Board,
  lens: SchemaCacheValue,
  anchors: BoardNode[],
  relations: Set<string>,
  targets: Set<string>,
  hops: number,
): Promise<WalkResult> {
  const state = { walked: 0, capped: false, followed: new Set<string>() };
  const seen = new Set(anchors.map((a) => a.card.id));
  let frontier = anchors;
  let depth = 0;
  while (depth < hops && frontier.length > 0) {
    depth++;
    const reached = (await hop(reader, board, lens, frontier, depth, { relations, direction: "any" }, state))
      .filter((node) => !seen.has(node.card.id));
    reached.forEach((node) => seen.add(node.card.id));
    if (reached.some((node) => targets.has(node.card.type))) {
      return { hops: depth, reachedAt: depth, found: state.walked, followed: [...state.followed], capped: state.capped };
    }
    frontier = reached;
  }
  return { hops: depth, reachedAt: null, found: state.walked, followed: [...state.followed], capped: state.capped };
}

/**
 * Follows a planned path hop by hop: each hop only along its relation. A
 * direction is a hint — a hop that finds nothing in it takes either, and a
 * self-relation's hop always takes both. A hop that finds nothing ends the
 * path unreached.
 */
export async function followPath(
  reader: GraphReader,
  board: Board,
  lens: SchemaCacheValue,
  anchors: BoardNode[],
  path: PathStep[],
): Promise<WalkResult> {
  const state = { walked: 0, capped: false, followed: new Set<string>() };
  let frontier = anchors;
  for (const [i, step] of path.entries()) {
    const relations = new Set([step.relation]);
    // A self-relation's direction is the one a model gets wrong most ("who
    // reports to her" vs "who manages her"); its hop takes both, and the
    // relation sentences the answer receives tell them apart.
    const type = lens.relationTypes[step.relation];
    const direction = type !== undefined && type.fromEntityTypeKey === type.toEntityTypeKey ? "any" : step.direction;
    let reached = await hop(reader, board, lens, frontier, i + 1, { relations, direction }, state);
    if (reached.length === 0 && direction !== "any") {
      reached = await hop(reader, board, lens, frontier, i + 1, { relations, direction: "any" }, state);
    }
    if (reached.length === 0) {
      return { hops: i + 1, reachedAt: null, found: state.walked, followed: [...state.followed], capped: state.capped };
    }
    frontier = reached;
  }
  return { hops: path.length, reachedAt: path.length, found: state.walked, followed: [...state.followed], capped: state.capped };
}

/** How many board relations touch the entity: the better connected first. */
function degree(board: Board, ref: string): number {
  return board.links.filter((link) => link.from === ref || link.to === ref).length;
}

/**
 * Marks the evidence: anchors and focus first, then the target entities —
 * best connected, then closest — each with the path back to its anchor,
 * then the rest by distance, up to `max`.
 */
export function focus(board: Board, targets: Set<string>, max: number): { evidence: BoardNode[]; targets: number } {
  const evidence = new Map<string, BoardNode>();
  const take = (node: BoardNode | undefined) => {
    if (node !== undefined && evidence.size < max) evidence.set(node.card.ref, node);
  };
  const all = board.nodes();
  for (const node of all) if (node.card.role !== "reached") take(node);
  const byConnection = (a: BoardNode, b: BoardNode) =>
    degree(board, b.card.ref) - degree(board, a.card.ref) || a.card.hop - b.card.hop;
  const reached = all.filter((node) => node.card.role === "reached");
  const targetNodes = reached.filter((node) => targets.has(node.card.type)).sort(byConnection);
  for (const node of targetNodes) {
    // The path first, so a target never arrives without the way to it.
    const path: BoardNode[] = [];
    for (let at = board.byRef(node.parent ?? ""); at && at.card.role === "reached"; at = board.byRef(at.parent ?? "")) {
      path.unshift(at);
    }
    if (evidence.size + path.filter((p) => !evidence.has(p.card.ref)).length + 1 > max) break;
    path.forEach(take);
    take(node);
  }
  const rest = reached.filter((node) => !evidence.has(node.card.ref)).sort((a, b) => a.card.hop - b.card.hop || byConnection(a, b));
  rest.forEach(take);
  for (const node of all) node.card.evidence = evidence.has(node.card.ref);
  const matches = [...evidence.values()].filter((n) => n.card.role !== "anchor" && targets.has(n.card.type)).length;
  return { evidence: [...evidence.values()], targets: matches };
}
