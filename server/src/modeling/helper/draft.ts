/**
 * The Studio helper's agent draft: the open agent editor's unsaved values,
 * sent with a message, and the one tool that proposes new values for them.
 * The tool checks the proposal as a save would — the agent config shape and
 * the grantable tool names (`service.checkAgentTools`) — and, beyond a save,
 * refuses a tool this deployment cannot run. It writes nothing: its result
 * is a draft artifact the person fills into the editor and saves there.
 */

import { z } from "zod";

import type { ContextBlock, Tool } from "../../assistants/index.js";
import { NotFoundError, ValidationError } from "../../core/exceptions.js";
import type { ModelingStore } from "../../core/ports.js";
import { MAX_KEY_LENGTH } from "../../core/schemas.js";
import { VALID_AGENT_TOOLS_CSV } from "../../runtime/toolNames.js";
import * as service from "../service.js";
import { expectedError } from "./tools.js";

type Row = Record<string, unknown>;

const Key = z.string().min(1).max(MAX_KEY_LENGTH);

/** The open agent editor: which agent (`agentKey` null for a new one), its
 * draft version — bumped by the editor on every edit — and its values;
 * `tools` null grants every tool. */
export const AgentDraft = z
  .object({
    target: z.object({ lensKey: Key, agentKey: Key.nullable() }).strict(),
    version: z.number().int().nonnegative(),
    fields: z
      .object({
        name: z.string(),
        description: z.string(),
        systemPrompt: z.string(),
        tools: z.array(z.string()).nullable(),
      })
      .strict(),
  })
  .strict();
export type AgentDraft = z.infer<typeof AgentDraft>;

export const FILL_AGENT_DRAFT = "fill_agent_draft";

const shown = (text: string) => (text === "" ? "(empty)" : text);

/** The draft as a labelled block: the person's own unsaved text. */
export function draftBlock(draft: AgentDraft): ContextBlock {
  const { target, fields } = draft;
  return {
    label: "Agent draft",
    source: "the agent editor the person has open, unsaved",
    text: [
      `lens: ${target.lensKey}`,
      `agent: ${target.agentKey ?? "(a new agent, not saved yet)"}`,
      `name: ${shown(fields.name)}`,
      `description: ${shown(fields.description)}`,
      `tools: ${fields.tools === null ? "all tools" : shown(fields.tools.join(", "))}`,
      "system prompt:",
      shown(fields.systemPrompt),
    ].join("\n"),
  };
}

const list = (names: string[]) => names.join(", ");

/** The draft tool for the open editor; `lacking` are the grantable tools this deployment cannot run. */
export function fillAgentDraftTool(draft: AgentDraft, store: ModelingStore, lacking: readonly string[]): Tool<null> {
  return {
    name: FILL_AGENT_DRAFT,
    description:
      "Propose new values for the agent in the editor the person has open (the Agent draft block). Pass " +
      "only the fields you change. name: the agent's name, not empty. description: what the agent is for, " +
      "shown to the people who chat with it. system_prompt: the agent's instructions; when it runs, the " +
      "schema its lens shows is appended. Grant tools with either all_tools: true (every tool) or tools: a " +
      `non-empty list of: ${VALID_AGENT_TOOLS_CSV}.` +
      (lacking.length === 0 ? "" : ` This server cannot run ${list([...lacking])}: never grant them.`) +
      " Nothing is saved: the person fills the editor from your proposal, reviews it and saves it. Returns " +
      "the proposal {target, sourceVersion, fields}; a refused field returns an error with the reason.",
    input: z.object({
      name: z.string().nullish(),
      description: z.string().nullish(),
      system_prompt: z.string().nullish(),
      all_tools: z.boolean().nullish(),
      tools: z.array(z.string()).nullish(),
    }),
    run: async (args) => {
      const fields: Row = {};
      const name = args.name as string | null | undefined;
      if (name != null) {
        if (name.trim() === "") throw new ValidationError("name: an agent needs a name; leave name out to keep it.");
        fields.name = name;
      }
      if (args.description != null) fields.description = args.description;
      if (args.system_prompt != null) fields.systemPrompt = args.system_prompt;
      const tools = args.tools as string[] | null | undefined;
      if (args.all_tools === true) {
        if (tools != null) throw new ValidationError("Give either all_tools: true or a tools list, not both.");
        fields.tools = null;
      } else if (tools != null) {
        if (tools.length === 0) throw new ValidationError("tools: grant at least one tool, or all_tools: true for every tool.");
        service.checkAgentTools(tools);
        const gated = tools.filter((tool) => lacking.includes(tool));
        if (gated.length > 0) throw new ValidationError(`This server cannot run ${list(gated)}; grant other tools.`);
        fields.tools = [...new Set(tools)];
      }
      if (Object.keys(fields).length === 0) {
        throw new ValidationError("Propose at least one of name, description, system_prompt, all_tools or tools.");
      }
      if (!(await store.getLensByKey(draft.target.lensKey))) {
        throw new NotFoundError(`Lens '${draft.target.lensKey}' not found`);
      }
      return { target: draft.target, sourceVersion: draft.version, fields };
    },
    expected: expectedError,
  };
}
