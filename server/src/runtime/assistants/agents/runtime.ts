/**
 * Agents at runtime (`docs/capabilities/agents.md`): agent chat and the
 * agent list — the runtime host of the tool loop (`assistants/loop.ts`).
 *
 * Each turn prepares a run with the agent's current configuration: its
 * prompt with the lens schema, and its tools bound to the lens
 * (`tools.ts`). A tool failure that is a not-found or validation error is
 * returned to the model as the tool's result so it can correct itself and
 * retry (`docs/capabilities/oql.md#self-correction-hints`); any other
 * error aborts the run. An entity tool's result is followed by the shared
 * `entities` event (`./entities.ts`).
 */

import { runToolLoop, type GraphThread, type StreamExecution } from "../../../assistants/index.js";
import { DEFAULT_AGENT_CONFIG, type AgentConfig } from "../../../core/ai.js";
import { NotFoundError } from "../../../core/exceptions.js";
import type { RuntimeStore } from "../../../core/ports.js";
import { loadSchema, type SchemaCacheValue } from "../../schemaCache.js";
import type { RuntimeAssistant } from "../assistant.js";
import { requireLanguageModel } from "../kit/model.js";
import { TurnEntities } from "./entities.js";
import { buildTools, resolveChatToolNames } from "./tools.js";

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Schema description builder (for system prompts)
// ---------------------------------------------------------------------------

/** Build a concise text description of the scoped schema for the LLM. */
export function describeSchema(schema: SchemaCacheValue): string {
  const lines = [`Lens: ${schema.lensName} (key: ${schema.lensKey})`];
  if (schema.lensDescription) {
    lines.push(`Description: ${schema.lensDescription}`);
  }

  lines.push("\nSystem properties (available on all entities and relations):");
  lines.push("  - _id: string (unique identifier)");
  lines.push("  - _createdAt: datetime");
  lines.push("  - _updatedAt: datetime");

  lines.push("\nEntity types:");
  for (const et of Object.values(schema.entityTypes)) {
    let desc = `  - ${et.key}`;
    if (et.description) {
      desc += `: ${et.description}`;
    }
    lines.push(desc);
    if (et.identityProperties !== null) {
      lines.push(`    identity (_identity): ${et.identityProperties.join(", ")}`);
    }
    for (const p of Object.values(et.properties)) {
      const req = p.required ? " (required)" : "";
      lines.push(`    - ${p.key}: ${p.dataType}${req}`);
      if (p.description) {
        lines.push(`      ${p.description}`);
      }
    }
  }

  lines.push("\nRelation types:");
  for (const rt of Object.values(schema.relationTypes)) {
    let desc = `  - ${rt.key}: ${rt.fromEntityTypeKey} -> ${rt.toEntityTypeKey}`;
    if (rt.description) {
      desc += ` (${rt.description})`;
    }
    lines.push(desc);
    for (const p of Object.values(rt.properties)) {
      const req = p.required ? " (required)" : "";
      lines.push(`    - ${p.key}: ${p.dataType}${req}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Feature: Schema-Aware Chat
// ---------------------------------------------------------------------------

/** The built-in prompt. It names no tool: an agent may have any subset,
 * and each tool says itself what it is for. */
const CHAT_SYSTEM_PROMPT = `You are a knowledge graph assistant. You answer questions from the data of one lens, with the tools you have. You can only read data, not create or change it. The Schema context block names what the lens shows; a newer one replaces an older one.

How to work:
- Use the exact keys from the schema as tool arguments (e.g. entity_type_key="person").
- Each tool says what it is for. Prefer one call that narrows, with a filter or a query, over many calls that read everything.
- A result that carries "more" left something out: it says what, and how to get it. Get more when the question needs it, and never present such a result as complete.
- A property shown as {"document": true, "length": N} is a large text held back from the result. Answer from its content only after reading the part you need.
- Name entities by their names, not by their ids.

Never make up answers — only use data from tool results. If the data doesn't contain the answer, say so. Be concise.`;

/** One turn of agent chat on a thread. */
export async function runAgentChat(
  agentConfig: AgentConfig,
  lensKey: string,
  message: string,
  store: RuntimeStore,
  thread: GraphThread,
  execution: Partial<StreamExecution> = {},
): Promise<Row> {
  execution.signal?.throwIfAborted();
  const loaded = await loadSchema(lensKey, store);

  // The agent's own prompt, else the built-in one; the schema the lens shows
  // is the state the tool loop keeps the thread on.
  const instructions = agentConfig.systemPrompt ?? CHAT_SYSTEM_PROMPT;
  const schema = { label: "Schema", source: "the schema the lens shows", text: describeSchema(loaded.scoped) };

  const toolNames = resolveChatToolNames(agentConfig, store);
  const model = requireLanguageModel();
  const { reply } = await runToolLoop({
    kind: "agent", instructions, state: [schema], context: [],
    tools: buildTools(lensKey, store, toolNames), ctx: new TurnEntities(loaded.scoped), model,
  }, message, thread, execution);
  execution.signal?.throwIfAborted();

  return { reply };
}

/** Resolve all chat prerequisites before the REST response starts: the
 * agent (`_default` is the built-in default) and the model. */
export async function prepareChat(lensKey: string, store: RuntimeStore, agentKey: string): Promise<AgentConfig> {
  const loaded = await loadSchema(lensKey, store);
  const config = agentKey === DEFAULT_AGENT_CONFIG.key ? DEFAULT_AGENT_CONFIG : loaded.agentConfigs[agentKey];
  if (!config) throw new NotFoundError(`Agent '${agentKey}' not found`);
  requireLanguageModel();
  return config;
}

// ---------------------------------------------------------------------------
// Agent list and schema text
// ---------------------------------------------------------------------------

/** The schema as every agent of the lens reads it: the text of the Schema
 * block that follows its prompt, built-in or its own. Needs no model. */
export async function agentSchemaText(lensKey: string, store: RuntimeStore): Promise<{ text: string }> {
  const loaded = await loadSchema(lensKey, store);
  return { text: describeSchema(loaded.scoped) };
}

/** Every agent of a lens, the built-in default first. Needs no model. */
export async function listRuntimeAgents(lensKey: string, store: RuntimeStore): Promise<RuntimeAssistant[]> {
  const loaded = await loadSchema(lensKey, store);
  return [DEFAULT_AGENT_CONFIG, ...Object.values(loaded.agentConfigs)].map((config) => ({
    key: config.key,
    name: config.name,
    description: config.description,
    builtIn: config === DEFAULT_AGENT_CONFIG,
  }));
}
