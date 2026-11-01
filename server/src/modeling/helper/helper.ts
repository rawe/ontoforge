/**
 * The Studio helper: one built-in, never-stored design helper per ontology
 * — the modeling host of the tool loop (`assistants/loop.ts`). It reads
 * the ontology's design only and writes nothing. Each turn prepares a run:
 * fixed instructions, the design briefing as its state, the page's focus
 * and the open editor's draft as the message's context, the design tools
 * (`tools.ts`) and the schema proposal tool (`propose.ts`) on every turn,
 * and — only while an editor with a draft is open — the tools of that
 * editor's drafter (`drafter.ts`, `drafters/`). A turn's last proposal
 * and its check are its artifact. Schema and lens
 * descriptions are untrusted text: they reach the model only inside
 * context blocks and tool results, never in the instructions.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  runToolLoop,
  type ContextBlock,
  type GraphThread,
  type PreparedRun,
  type StreamExecution,
  type Tool,
} from "../../assistants/index.js";
import type { ModelingStore } from "../../core/ports.js";
import { addressLines, DesignAddress } from "./address.js";
import { draftPart, type DraftPart, type DraftPayload } from "./drafters/index.js";
import { proposeSchemaChangeTool, turnArtifacts, type StudioTurn } from "./propose.js";
import { designTools, lensScope, readDesign } from "./tools.js";

type Row = Record<string, unknown>;

/** The kind threads and tool events carry (`studio.tool_call`, `studio.tool_result`). */
export const STUDIO_KIND = "studio";

/** The one built-in helper; its name is a working name. */
export const STUDIO_HELPER = { key: "_default", name: "Studio helper" } as const;

/** What the Studio page shows the person: a design item's address, never prose. */
export const Focus = DesignAddress;
export type Focus = DesignAddress;

export const INSTRUCTIONS = `You are the design helper in the OntoForge Studio. You help the person who administers this ontology understand and review its design: entity types, relation types and their properties, lenses and their scope, and search indices.

You read the design only. You never see instance data (entities, relations, documents, counts), and you cannot change anything yourself.

When the person asks you to create or extend the schema — entity types, relation types, properties, descriptions — call propose_schema_change with the complete proposal. It writes nothing: the server checks it, and the person reviews and applies it in the Studio. If the check refuses a step, fix the proposal and call it again. Never say a change was made or applied: say what you propose and that the person applies it. Describe any other change (deletes, renames, lenses, search indices) as steps the person takes in the Studio.

While the person has an editor open that you can fill, their message comes with a draft block of its unsaved values, and only then do you have the tool that fills that draft; its description says how. Only when they ask you to draft, write or change what that editor holds, call it. The person fills the editor from your proposal, reviews it and saves it themselves; say so briefly. Without such an editor open, describe the item in your answer instead.

Context blocks give an outline of the schema and the lenses — a newer one replaces an older one — and, with a message, what the person has open, if anything. Use the tools for details and for validation results, and use exact keys as tool arguments. Answer from the design you read; say so when the design does not tell. Be concise.`;

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

/** What a turn brings beside its message: the page's focus and the open editor's draft. */
export interface StudioTurnContext {
  focus?: Focus;
  draft?: DraftPayload;
}

/** What a prepared turn takes beside its message: the page's focus and the open draft's part. */
export interface StudioTurnParts {
  focus?: Focus;
  draft?: DraftPart;
}

/** The design briefing: the schema and the lenses, each a labelled block —
 * the state the helper works on. */
export function briefing(ontologyKey: string, design: Row): ContextBlock[] {
  return [
    { label: "Schema outline", source: "the ontology's schema", text: schemaOutline(ontologyKey, design) },
    { label: "Lenses", source: "the ontology's lenses", text: lensOutline(design) },
  ];
}

/** What goes with one message: the page's focus and the open draft, each a labelled block. */
export function turnContext({ focus, draft }: StudioTurnParts): ContextBlock[] {
  const blocks: ContextBlock[] = [];
  if (focus !== undefined) blocks.push({ label: "Focus", source: "the Studio page the person has open", text: addressLines(focus).join("\n") });
  if (draft !== undefined) blocks.push(draft.block);
  return blocks;
}

/** One turn's run over `design`, the store's design as `readDesign` reads it. */
export function studioRun(
  ontologyKey: string,
  design: Row,
  turn: StudioTurnParts,
  store: ModelingStore,
  model: BaseChatModel,
): PreparedRun<StudioTurn> {
  const tools: Tool<StudioTurn>[] = [...designTools(store), proposeSchemaChangeTool(store), ...(turn.draft?.tools ?? [])];
  return {
    kind: STUDIO_KIND, instructions: INSTRUCTIONS, state: briefing(ontologyKey, design), context: turnContext(turn),
    tools, ctx: { proposal: null }, model,
  };
}

/** One turn of the Studio helper on a thread: its reply and artifacts. */
export async function runStudioChat(
  ontologyKey: string,
  turn: { message: string } & StudioTurnContext,
  store: ModelingStore,
  model: BaseChatModel,
  thread: GraphThread,
  execution: Partial<StreamExecution> = {},
): Promise<Row> {
  const design = await readDesign(store);
  execution.signal?.throwIfAborted();
  const draft = turn.draft === undefined ? undefined : await draftPart(turn.draft, store);
  const parts: StudioTurnParts = { ...(turn.focus === undefined ? {} : { focus: turn.focus }), ...(draft === undefined ? {} : { draft }) };
  const run = studioRun(ontologyKey, design, parts, store, model);
  const { reply } = await runToolLoop(run, turn.message, thread, execution);
  execution.signal?.throwIfAborted();
  return { reply, artifacts: turnArtifacts(run.ctx) };
}
