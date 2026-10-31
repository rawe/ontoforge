/**
 * The Studio helper: one built-in, never-stored design helper per ontology
 * — the modeling host of the tool loop (`assistants/loop.ts`). It reads
 * the ontology's design only and writes nothing. Each turn prepares a run:
 * fixed instructions, a design briefing and the page's focus as labelled
 * context blocks, and the design tools (`tools.ts`). Schema and lens
 * descriptions are untrusted text: they reach the model only inside
 * context blocks and tool results, never in the instructions.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";

import {
  runToolLoop,
  type ContextBlock,
  type GraphThread,
  type PreparedRun,
  type StreamExecution,
} from "../../assistants/index.js";
import type { ModelingStore } from "../../core/ports.js";
import { MAX_KEY_LENGTH } from "../../core/schemas.js";
import { designTools, lensScope, readDesign } from "./tools.js";

type Row = Record<string, unknown>;

/** The kind threads and tool events carry (`studio.tool_call`, `studio.tool_result`). */
export const STUDIO_KIND = "studio";

/** The one built-in helper; its name is a working name. */
export const STUDIO_HELPER = { key: "_default", name: "Studio helper" } as const;

const Key = z.string().min(1).max(MAX_KEY_LENGTH);

/** What the Studio page shows the person: structured, never prose. A
 * property names its type in `typeKey`, an agent its lens in `lensKey`. */
export const Focus = z
  .object({
    kind: z.enum(["entityType", "relationType", "property", "lens", "agent"]),
    key: Key,
    typeKey: Key.optional(),
    lensKey: Key.optional(),
  })
  .strict();
export type Focus = z.infer<typeof Focus>;

export const INSTRUCTIONS = `You are the design helper in the OntoForge Studio. You help the person who administers this ontology understand and review its design: entity types, relation types and their properties, lenses and their scope, and search indices.

You read the design only. You never see instance data (entities, relations, documents, counts), and you cannot change anything: when a change would help, describe it as steps the person takes in the Studio.

The context blocks give an outline of the schema and the lenses as of this message, and what the person has open, if anything. Use the tools for details and for validation results, and use exact keys as tool arguments. Answer from the design you read; say so when the design does not tell. Be concise.`;

const withDescription = (text: unknown) => (typeof text === "string" && text !== "" ? ` — ${text}` : "");

function propertyLines(properties: Row[], indent: string): string[] {
  return properties.map((p) =>
    `${indent}- ${p.key} (${p.displayName}): ${p.dataType}${p.required ? ", required" : ""}` +
    `${p.defaultValue === null || p.defaultValue === undefined ? "" : `, default ${p.defaultValue}`}${withDescription(p.description)}`);
}

/** The schema as outline lines: each type with its properties and descriptions. */
function schemaOutline(ontologyKey: string, design: Row): string {
  const lines = [`Ontology: ${ontologyKey}`, "", "Entity types:"];
  const entityTypes = design.entityTypes as Row[];
  if (entityTypes.length === 0) lines.push("  (none)");
  for (const et of entityTypes) {
    const identity = et.identityProperties ? `; identity: ${(et.identityProperties as string[]).join(", ")}` : "";
    lines.push(`- ${et.key} (${et.displayName}); name property: ${et.nameProperty}${identity}${withDescription(et.description)}`);
    lines.push(...propertyLines(et.properties as Row[], "  "));
  }
  lines.push("", "Relation types:");
  const relationTypes = design.relationTypes as Row[];
  if (relationTypes.length === 0) lines.push("  (none)");
  for (const rt of relationTypes) {
    const parent = rt.parent ? `; parent: ${rt.parent}` : "";
    const onePerPair = rt.onePerPair ? "; one per pair" : "";
    lines.push(`- ${rt.key} (${rt.displayName}): ${rt.fromEntityTypeKey} -> ${rt.toEntityTypeKey}${parent}${onePerPair}${withDescription(rt.description)}`);
    lines.push(...propertyLines(rt.properties as Row[], "  "));
  }
  return lines.join("\n");
}

/** The lenses as outline lines: each with its scope. */
function lensOutline(design: Row): string {
  const lenses = (design.lenses as Row[]).map(lensScope);
  if (lenses.length === 0) return "(no lenses)";
  const included = (rows: Row[]) => rows.map((row) =>
    row.properties === null ? String(row.key) : `${row.key} [${(row.properties as string[]).join(", ")}]`).join(", ") || "none";
  return lenses.map((lens) => {
    const includes = lens.includes as { entityTypes: Row[]; relationTypes: Row[] } | null;
    const scope = includes === null
      ? "the whole schema"
      : `entity types ${included(includes.entityTypes)}; relation types ${included(includes.relationTypes)}`;
    const indices = (lens.searchIndices as string[]).join(", ") || "none";
    return `- ${lens.key} (${lens.name}): shows ${scope}; search indices: ${indices}${withDescription(lens.description)}`;
  }).join("\n");
}

function focusText(focus: Focus): string {
  return Object.entries(focus).map(([field, value]) => `${field}: ${value}`).join("\n");
}

/** The design briefing and the focus, each a labelled block. */
export function briefing(ontologyKey: string, design: Row, focus?: Focus): ContextBlock[] {
  const blocks: ContextBlock[] = [
    { label: "Schema outline", source: "the ontology's schema", text: schemaOutline(ontologyKey, design) },
    { label: "Lenses", source: "the ontology's lenses", text: lensOutline(design) },
  ];
  if (focus !== undefined) blocks.push({ label: "Focus", source: "the Studio page the person has open", text: focusText(focus) });
  return blocks;
}

/** One turn's run over `design`, the store's design as `readDesign` reads it. */
export function studioRun(
  ontologyKey: string,
  design: Row,
  focus: Focus | undefined,
  store: ModelingStore,
  model: BaseChatModel,
): PreparedRun<null> {
  return {
    kind: STUDIO_KIND, instructions: INSTRUCTIONS, context: briefing(ontologyKey, design, focus),
    tools: designTools(store), ctx: null, model,
  };
}

/** One turn of the Studio helper on a thread. */
export async function runStudioChat(
  ontologyKey: string,
  turn: { message: string; focus?: Focus },
  store: ModelingStore,
  model: BaseChatModel,
  thread: GraphThread,
  execution: Partial<StreamExecution> = {},
): Promise<Row> {
  const design = await readDesign(store);
  execution.signal?.throwIfAborted();
  const run = studioRun(ontologyKey, design, turn.focus, store, model);
  const { reply } = await runToolLoop(run, turn.message, thread, execution);
  execution.signal?.throwIfAborted();
  return { reply };
}
