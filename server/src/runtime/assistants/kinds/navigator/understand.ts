/**
 * The understand step: one structured model call that reads the question
 * against the lens's schema and says where to start (mentions), what the
 * answer is about (target types), which relations likely lead there, and
 * whether the question refers back to the previous answer. Type keys are
 * constrained to what the lens shows; whatever the model returns is
 * checked again, never trusted.
 */

import type { SchemaCacheValue } from "../../../schemaCache.js";
import type { JsonSchema } from "../../kit/model.js";
import type { FocusEntity } from "./walk.js";

/** One hop of a planned path: a relation type, and which end the walk is at. */
export interface PathStep {
  relation: string;
  /** `outgoing`: from the relation's source to its target; `incoming`: back; `any`: either. */
  direction: "outgoing" | "incoming" | "any";
}

export interface Intent {
  mentions: { text: string; types: string[] }[];
  targets: string[];
  /** The relations from the mentions to the targets, in order; empty when unsure. */
  path: PathStep[];
  useFocus: boolean;
  search: string;
}

/** Mentions one question resolves at most. */
const MAX_MENTIONS = 5;
/** Hops a planned path has at most. */
const MAX_PATH = 3;

/** A list of type keys: constrained to the given ones when there are any. */
function keys(allowed: string[]): JsonSchema {
  return { type: "array", items: allowed.length > 0 ? { type: "string", enum: allowed } : { type: "string" } };
}

export function intentSchema(entityTypes: string[], anchorTypes: string[], relationTypes: string[]): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      mentions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { text: { type: "string" }, types: keys(anchorTypes) },
          required: ["text", "types"],
        },
      },
      targets: keys(entityTypes),
      path: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            relation: relationTypes.length > 0 ? { type: "string", enum: relationTypes } : { type: "string" },
            direction: { type: "string", enum: ["outgoing", "incoming", "any"] },
          },
          required: ["relation", "direction"],
        },
      },
      useFocus: { type: "boolean" },
      search: { type: "string" },
    },
    required: ["mentions", "targets", "path", "useFocus", "search"],
  };
}

export const UNDERSTAND = `You plan a walk through a knowledge graph. Read the user's question against the schema and answer with JSON only.

- mentions: the concrete things the question names that the walk should start from — names, titles, codes, specific values (e.g. "Lena", "Apollo", "Kubernetes", "Hall 3"). Keep the user's spelling. Not generic nouns ("people", "projects"). For each, types: the entity types it may be, from the schema; [] if unsure.
- targets: the entity types the answer lists or is about. Usually one.
- path: the relations to follow from the mentions (or the previous answer's entities) to what the question asks for, in order, one entry per hop. direction "outgoing" when the entity you are at is the relation's FROM side, "incoming" when it is the TO side, "any" if unsure. Include every hop the question needs ("X's reports and their teams" = manages outgoing, then member_of outgoing). When the question also asks where, to whom or to what the found entities belong ("and in which hall", "and their team"), end the path with that hop. [] when the question names no clear route.
- useFocus: true when the question refers back to entities of the previous answer ("they", "these", "them", "her reports", "the second one") or leaves its subject out. The path then starts at those entities. Still list every concrete thing the question names as a mention ("which of them work on Rust projects" → useFocus true, mentions ["Rust"]).
- search: when the question names nothing concrete and does not refer back, a short search phrase for its topic (e.g. "robotics workshops"); otherwise "".`;

/** The schema as the planner reads it: keys with display names, endpoints, descriptions. */
export function schemaText(lens: SchemaCacheValue, relations: Set<string>, anchors: Set<string>): string {
  const lines = ["ENTITY TYPES (key: name — description):"];
  for (const type of Object.values(lens.entityTypes)) {
    const anchorable = anchors.has(type.key) ? "" : " [never a mention]";
    lines.push(`- ${type.key}: ${type.displayName}${type.description ? ` — ${type.description}` : ""}${anchorable}`);
  }
  lines.push("RELATION TYPES (key: from → to — name):");
  for (const type of Object.values(lens.relationTypes)) {
    if (!relations.has(type.key)) continue;
    lines.push(`- ${type.key}: ${type.fromEntityTypeKey} → ${type.toEntityTypeKey} — ${type.displayName}`);
  }
  return lines.join("\n");
}

export function understandInput(
  schema: string,
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
  previous: FocusEntity[],
): string {
  const parts = [schema];
  if (history.length > 0) {
    parts.push("CONVERSATION (oldest first):");
    for (const message of history) parts.push(`${message.role}: ${message.content.slice(0, 600)}`);
  }
  if (previous.length > 0) {
    parts.push(`ENTITIES OF THE PREVIOUS ANSWER: ${previous.map((p) => `${p.label} (${p.type})`).join("; ")}`);
  }
  parts.push(`QUESTION: ${question}`);
  return parts.join("\n\n");
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** The model's output, checked: unknown keys and empty mentions dropped. */
export function parseIntent(
  raw: unknown,
  lens: SchemaCacheValue,
  relations: Set<string>,
  anchors: Set<string>,
): Intent {
  const value = (raw ?? {}) as Record<string, unknown>;
  const mentions = (Array.isArray(value.mentions) ? value.mentions : [])
    .map((m) => (m ?? {}) as Record<string, unknown>)
    .filter((m) => typeof m.text === "string" && m.text.trim() !== "")
    .map((m) => ({ text: (m.text as string).trim().slice(0, 200), types: strings(m.types).filter((t) => anchors.has(t)) }))
    .slice(0, MAX_MENTIONS);
  const path = (Array.isArray(value.path) ? value.path : [])
    .map((step) => (step ?? {}) as Record<string, unknown>)
    .filter((step) => typeof step.relation === "string" && relations.has(step.relation))
    .map((step): PathStep => ({
      relation: step.relation as string,
      direction: step.direction === "outgoing" || step.direction === "incoming" ? step.direction : "any",
    }))
    .slice(0, MAX_PATH);
  return {
    mentions,
    targets: [...new Set(strings(value.targets).filter((t) => t in lens.entityTypes))],
    path,
    useFocus: value.useFocus === true,
    search: typeof value.search === "string" ? value.search.slice(0, 200) : "",
  };
}

/** The step summary: what the walk will look for, in display names. */
export function intentSummary(intent: Intent, lens: SchemaCacheValue): string {
  const names = (keys: string[], of: Record<string, { displayName: string }>) =>
    keys.map((k) => of[k]?.displayName ?? k).join(", ");
  const parts: string[] = [];
  if (intent.targets.length > 0) parts.push(`Looking for ${names(intent.targets, lens.entityTypes)}`);
  if (intent.mentions.length > 0) parts.push(`starting at ${intent.mentions.map((m) => `“${m.text}”`).join(", ")}`);
  if (intent.useFocus) parts.push("continuing from the previous answer");
  if (intent.mentions.length === 0 && !intent.useFocus && intent.search) parts.push(`topic “${intent.search}”`);
  if (intent.path.length > 0) parts.push(`path ${pathText(intent.path, lens)}`);
  return parts.join(" · ") || "No starting point in the question";
}

/** A planned path in display names: "manages → member of". */
export function pathText(path: PathStep[], lens: SchemaCacheValue): string {
  return path
    .map((step) => {
      const name = (lens.relationTypes[step.relation]?.displayName ?? step.relation).toLowerCase();
      return step.direction === "incoming" ? `${name} (backwards)` : name;
    })
    .join(" → ");
}
